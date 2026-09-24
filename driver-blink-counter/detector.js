/**
 * detector.js - High Precision Eye Blink & Drowsiness Tracking Engine
 * Uses Eye Aspect Ratio (EAR) with MediaPipe Face Mesh.
 * Operates completely on-device. No data leaves the device.
 */

class EyeBlinkDetector {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.canvasCtx = this.canvasElement ? this.canvasElement.getContext('2d') : null;

    // Callbacks
    this.onBlink = options.onBlink || (() => {});
    this.onDrowsiness = options.onDrowsiness || (() => {});
    this.onDrowsinessResolved = options.onDrowsinessResolved || (() => {});
    this.onEARUpdate = options.onEARUpdate || (() => {});
    this.onFaceStatus = options.onFaceStatus || (() => {});

    // Detection Parameters
    this.earThreshold = 0.22;            // Below this = eye closed
    this.drowsinessTimeoutMs = 1500;     // Eyes closed > 1.5s = Micro-sleep alarm
    this.minBlinkDurationMs = 70;        // Quickest valid physiological blink
    this.maxBlinkDurationMs = 700;       // Longest standard blink closure

    // State Tracking
    this.isRunning = false;
    this.faceDetected = false;
    this.eyeState = 'OPEN';              // 'OPEN' | 'CLOSED'
    this.closedStartTime = 0;
    this.lastBlinkTime = performance.now();
    this.isDrowsyAlertActive = false;

    // Baseline Calibration
    this.isCalibrating = false;
    this.calibrationSamples = [];
    this.baselineOpenEAR = 0.30;

    // MediaPipe & Camera references
    this.faceMesh = null;
    this.camera = null;
    this.animationFrameId = null;

    // Landmark indices for MediaPipe Face Mesh (6 points per eye)
    // Left eye: 33 (outer), 133 (inner), 160 (top-outer), 158 (top-inner), 144 (bottom-outer), 153 (bottom-inner)
    this.LEFT_EYE = [33, 160, 158, 133, 153, 144];
    // Right eye: 263 (outer), 362 (inner), 385 (top-outer), 387 (top-inner), 373 (bottom-outer), 380 (bottom-inner)
    this.RIGHT_EYE = [263, 385, 387, 362, 380, 373];
  }

  setVideoAndCanvas(video, canvas) {
    this.videoElement = video;
    this.canvasElement = canvas;
    this.canvasCtx = canvas ? canvas.getContext('2d') : null;
  }

  setThreshold(threshold) {
    this.earThreshold = parseFloat(threshold);
  }

  setDrowsinessTimeout(ms) {
    this.drowsinessTimeoutMs = parseInt(ms, 10);
  }

  startCalibration(durationMs = 4000) {
    this.isCalibrating = true;
    this.calibrationSamples = [];
    setTimeout(() => {
      if (this.calibrationSamples.length > 15) {
        // Average the top 80% open EAR samples
        this.calibrationSamples.sort((a, b) => b - a);
        const topSlice = this.calibrationSamples.slice(0, Math.floor(this.calibrationSamples.length * 0.8));
        const avg = topSlice.reduce((sum, v) => sum + v, 0) / topSlice.length;
        this.baselineOpenEAR = avg;
        // Optimal EAR threshold is ~70-75% of resting open eye
        this.earThreshold = Math.max(0.18, Math.min(0.28, avg * 0.73));
        console.log(`Calibrated baseline: ${avg.toFixed(3)}, threshold: ${this.earThreshold.toFixed(3)}`);
      }
      this.isCalibrating = false;
    }, durationMs);
  }

  // Calculate Euclidean distance between two 2D/3D points
  euclideanDist(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Calculate Eye Aspect Ratio (EAR) for 6 landmark points
  calculateEAR(landmarks, indices) {
    const p1 = landmarks[indices[0]]; // Outer corner
    const p2 = landmarks[indices[1]]; // Upper lid 1
    const p3 = landmarks[indices[2]]; // Upper lid 2
    const p4 = landmarks[indices[3]]; // Inner corner
    const p5 = landmarks[indices[4]]; // Lower lid 2
    const p6 = landmarks[indices[5]]; // Lower lid 1

    // Vertical distances
    const v1 = this.euclideanDist(p2, p6);
    const v2 = this.euclideanDist(p3, p5);
    // Horizontal distance
    const h = this.euclideanDist(p1, p4);

    if (h === 0) return 0;
    return (v1 + v2) / (2.0 * h);
  }

  async initFaceMesh() {
    if (this.faceMesh) return true;

    // Check if FaceMesh is available globally (from CDN / bundled script)
    if (typeof FaceMesh === 'undefined') {
      console.warn('FaceMesh global not yet loaded.');
      return false;
    }

    try {
      this.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.faceMesh.onResults((results) => this.processResults(results));
      return true;
    } catch (e) {
      console.error('Failed to initialize FaceMesh:', e);
      return false;
    }
  }

  async startCamera() {
    this.isRunning = true;
    this.lastBlinkTime = performance.now();

    // Request front-facing camera optimized for dashboard
    const constraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = stream;
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });

      // Resize canvas to match video
      if (this.canvasElement) {
        this.canvasElement.width = this.videoElement.videoWidth || 640;
        this.canvasElement.height = this.videoElement.videoHeight || 480;
      }

      await this.initFaceMesh();

      // Start detection loop
      this.runDetectionLoop();
      return true;
    } catch (err) {
      console.error('Camera access error:', err);
      throw err;
    }
  }

  runDetectionLoop() {
    if (!this.isRunning) return;

    const detect = async () => {
      if (!this.isRunning) return;

      if (this.faceMesh && this.videoElement && this.videoElement.readyState >= 2) {
        try {
          await this.faceMesh.send({ image: this.videoElement });
        } catch (err) {
          // ignore transient frame drop
        }
      }

      this.animationFrameId = requestAnimationFrame(detect);
    };

    detect();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.videoElement && this.videoElement.srcObject) {
      const tracks = this.videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
    if (this.isDrowsyAlertActive) {
      this.isDrowsyAlertActive = false;
      this.onDrowsinessResolved();
    }
  }

  processResults(results) {
    if (!this.isRunning) return;

    const ctx = this.canvasCtx;
    if (ctx && this.canvasElement) {
      ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (this.faceDetected) {
        this.faceDetected = false;
        this.onFaceStatus(false);
      }
      return;
    }

    if (!this.faceDetected) {
      this.faceDetected = true;
      this.onFaceStatus(true);
    }

    const landmarks = results.multiFaceLandmarks[0];
    const leftEAR = this.calculateEAR(landmarks, this.LEFT_EYE);
    const rightEAR = this.calculateEAR(landmarks, this.RIGHT_EYE);
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    // Collect calibration samples if active
    if (this.isCalibrating) {
      this.calibrationSamples.push(avgEAR);
    }

    const now = performance.now();
    this.onEARUpdate({
      ear: avgEAR,
      leftEAR: leftEAR,
      rightEAR: rightEAR,
      threshold: this.earThreshold
    });

    // Draw visual landmarks on canvas
    if (ctx && this.canvasElement) {
      this.drawEyeLandmarks(ctx, landmarks);
    }

    // State Machine for Blink & Drowsiness Detection
    if (avgEAR < this.earThreshold) {
      // Eyes are currently CLOSED
      if (this.eyeState === 'OPEN') {
        this.eyeState = 'CLOSED';
        this.closedStartTime = now;
      } else {
        // Continuous closure check for drowsiness / micro-sleep
        const closedDuration = now - this.closedStartTime;
        if (closedDuration >= this.drowsinessTimeoutMs) {
          if (!this.isDrowsyAlertActive) {
            this.isDrowsyAlertActive = true;
          }
          this.onDrowsiness(closedDuration);
        }
      }
    } else {
      // Eyes are currently OPEN
      if (this.eyeState === 'CLOSED') {
        const closedDuration = now - this.closedStartTime;
        this.eyeState = 'OPEN';

        // Check if this closure qualified as a legitimate blink
        if (closedDuration >= this.minBlinkDurationMs && closedDuration <= this.maxBlinkDurationMs) {
          const intervalSec = (now - this.lastBlinkTime) / 1000.0;
          this.lastBlinkTime = now;

          this.onBlink({
            durationMs: Math.round(closedDuration),
            intervalSec: intervalSec > 0 ? intervalSec : 0,
            timestamp: Date.now()
          });
        }

        // If drowsiness alarm was sounding, resolve it immediately
        if (this.isDrowsyAlertActive) {
          this.isDrowsyAlertActive = false;
          this.onDrowsinessResolved();
        }
      }
    }
  }

  drawEyeLandmarks(ctx, landmarks) {
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;

    // Mirror horizontal canvas coordinate to match selfie camera view
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.eyeState === 'CLOSED' ? '#ef4444' : '#10b981';
    ctx.fillStyle = this.eyeState === 'CLOSED' ? '#ef4444' : '#38bdf8';

    // Draw eye contours
    [this.LEFT_EYE, this.RIGHT_EYE].forEach((indices) => {
      ctx.beginPath();
      indices.forEach((idx, i) => {
        const pt = landmarks[idx];
        const x = pt.x * width;
        const y = pt.y * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();

      indices.forEach((idx) => {
        const pt = landmarks[idx];
        const x = pt.x * width;
        const y = pt.y * height;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    });

    ctx.restore();
  }

  // Simulator helper: triggers a simulated blink for testing without camera
  simulateBlink(durationMs = 220) {
    const now = performance.now();
    const intervalSec = (now - this.lastBlinkTime) / 1000.0;
    this.lastBlinkTime = now;
    this.onBlink({
      durationMs: durationMs,
      intervalSec: intervalSec > 0 ? intervalSec : 2.5,
      timestamp: Date.now()
    });
  }
}

window.EyeBlinkDetector = EyeBlinkDetector;
