/**
 * app.js - Main Application Coordinator for DriverBlink
 * Handles session state, metrics calculation, UI updates, and session records.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const videoEl = document.getElementById('cameraVideo');
  const canvasEl = document.getElementById('trackingCanvas');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const simulateBtn = document.getElementById('simulateBtn');
  const testAlarmBtn = document.getElementById('testAlarmBtn');
  const calibrateBtn = document.getElementById('calibrateBtn');
  const historyBtn = document.getElementById('historyBtn');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const hudToggle = document.getElementById('hudToggle');
  const batterySaverToggle = document.getElementById('batterySaverToggle');
  const soundToggle = document.getElementById('soundToggle');
  const voiceToggle = document.getElementById('voiceToggle');
  const earThresholdSlider = document.getElementById('earThresholdSlider');
  const earThresholdVal = document.getElementById('earThresholdVal');
  const cameraContainer = document.getElementById('cameraContainer');

  // Displays
  const blinkCountDisplay = document.getElementById('blinkCountDisplay');
  const avgIntervalDisplay = document.getElementById('avgIntervalDisplay');
  const bpmDisplay = document.getElementById('bpmDisplay');
  const timerDisplay = document.getElementById('timerDisplay');
  const alertnessBadge = document.getElementById('alertnessBadge');
  const drowsinessBanner = document.getElementById('drowsinessBanner');
  const earProgressBar = document.getElementById('earProgressBar');
  const earCurrentVal = document.getElementById('earCurrentVal');
  const cameraStatusText = document.getElementById('cameraStatusText');
  const historyModal = document.getElementById('historyModal');
  const historyTableBody = document.getElementById('historyTableBody');
  const emptyHistoryMsg = document.getElementById('emptyHistoryMsg');

  // Application State
  let sessionState = 'IDLE'; // 'IDLE' | 'RUNNING' | 'PAUSED'
  let sessionStartTime = null;
  let sessionElapsedSeconds = 0;
  let sessionTimerInterval = null;
  let currentSessionBlinks = 0;
  let currentSessionIntervals = [];
  let currentDrowsinessCount = 0;
  let recentBlinkTimestamps = []; // Last 60s timestamps for rolling BPM
  let lastVoiceReportMinute = 0;

  // Initialize Detector
  const detector = new EyeBlinkDetector({
    videoElement: videoEl,
    canvasElement: canvasEl,
    onBlink: handleBlinkDetected,
    onDrowsiness: handleDrowsinessAlert,
    onDrowsinessResolved: handleDrowsinessResolved,
    onEARUpdate: handleEARUpdate,
    onFaceStatus: handleFaceStatus
  });

  // Sound Engine setup
  if (soundToggle) {
    soundToggle.addEventListener('change', (e) => {
      window.soundEngine.soundEffectsEnabled = e.target.checked;
    });
  }
  if (voiceToggle) {
    voiceToggle.addEventListener('change', (e) => {
      window.soundEngine.voiceAlertsEnabled = e.target.checked;
    });
  }

  // Threshold Slider setup
  if (earThresholdSlider) {
    earThresholdSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      earThresholdVal.textContent = val.toFixed(2);
      detector.setThreshold(val);
    });
  }

  // --- Session Management ---

  startBtn.addEventListener('click', async () => {
    if (sessionState === 'PAUSED') {
      resumeSession();
      return;
    }
    await startNewSession();
  });

  pauseBtn.addEventListener('click', () => {
    pauseSession();
  });

  stopBtn.addEventListener('click', () => {
    stopAndSaveSession();
  });

  simulateBtn.addEventListener('click', () => {
    if (sessionState !== 'RUNNING') {
      alert('Start the drive session first to simulate blinks.');
      return;
    }
    detector.simulateBlink(180);
  });

  testAlarmBtn.addEventListener('click', () => {
    window.soundEngine.startDrowsinessAlarm();
    setTimeout(() => {
      window.soundEngine.stopDrowsinessAlarm();
    }, 2500);
  });

  calibrateBtn.addEventListener('click', () => {
    calibrateBtn.disabled = true;
    calibrateBtn.textContent = 'Calibrating (Keep eyes open)...';
    detector.startCalibration(4000);
    setTimeout(() => {
      calibrateBtn.disabled = false;
      calibrateBtn.textContent = 'Auto-Calibrate';
      earThresholdSlider.value = detector.earThreshold.toFixed(2);
      earThresholdVal.textContent = detector.earThreshold.toFixed(2);
      window.soundEngine.speak('Calibration complete.');
    }, 4200);
  });

  // Fullscreen / HUD mode
  hudToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('hud-mode');
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      document.body.classList.remove('hud-mode');
    }
  });

  // Battery Saver mode
  batterySaverToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      cameraContainer.classList.add('battery-saver-hidden');
    } else {
      cameraContainer.classList.remove('battery-saver-hidden');
    }
  });

  async function startNewSession() {
    try {
      cameraStatusText.textContent = 'Starting camera & face mesh...';
      cameraStatusText.className = 'status-badge status-loading';

      await detector.startCamera();

      sessionState = 'RUNNING';
      sessionStartTime = new Date();
      sessionElapsedSeconds = 0;
      currentSessionBlinks = 0;
      currentSessionIntervals = [];
      currentDrowsinessCount = 0;
      recentBlinkTimestamps = [];
      lastVoiceReportMinute = 0;

      updateUI();
      startTimer();

      startBtn.disabled = true;
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
      simulateBtn.disabled = false;

      cameraStatusText.textContent = 'Camera Active - Tracking Eyes';
      cameraStatusText.className = 'status-badge status-active';

      window.soundEngine.playStartCue();
      window.soundEngine.speak('Drive session started. Eye tracking active.');
    } catch (err) {
      console.error(err);
      cameraStatusText.textContent = 'Camera Error: ' + (err.message || 'Permission denied');
      cameraStatusText.className = 'status-badge status-danger';
      alert('Could not start camera. Please ensure camera permissions are allowed and using HTTPS/localhost.');
    }
  }

  function pauseSession() {
    sessionState = 'PAUSED';
    clearInterval(sessionTimerInterval);
    startBtn.disabled = false;
    startBtn.textContent = 'Resume Drive';
    pauseBtn.disabled = true;
    cameraStatusText.textContent = 'Session Paused';
    cameraStatusText.className = 'status-badge status-warning';
    window.soundEngine.speak('Drive session paused.');
  }

  function resumeSession() {
    sessionState = 'RUNNING';
    startTimer();
    startBtn.disabled = true;
    startBtn.textContent = 'Drive in Progress';
    pauseBtn.disabled = false;
    cameraStatusText.textContent = 'Camera Active - Tracking Eyes';
    cameraStatusText.className = 'status-badge status-active';
    window.soundEngine.speak('Drive session resumed.');
  }

  function stopAndSaveSession() {
    if (sessionState === 'IDLE') return;

    clearInterval(sessionTimerInterval);
    detector.stop();
    window.soundEngine.stopDrowsinessAlarm();

    // Save session record
    const history = getSessionHistory();
    const sessionNum = history.length + 1;
    const avgInterval = currentSessionBlinks > 0 
      ? (sessionElapsedSeconds / currentSessionBlinks).toFixed(1) 
      : '0.0';
    const avgBPM = sessionElapsedSeconds > 0 
      ? ((currentSessionBlinks / sessionElapsedSeconds) * 60).toFixed(1) 
      : '0.0';

    const sessionRecord = {
      id: `Session #${sessionNum}`,
      date: sessionStartTime ? sessionStartTime.toLocaleDateString() : new Date().toLocaleDateString(),
      startTime: sessionStartTime ? sessionStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      durationSeconds: sessionElapsedSeconds,
      durationFormatted: formatTime(sessionElapsedSeconds),
      totalBlinks: currentSessionBlinks,
      avgIntervalSec: parseFloat(avgInterval),
      avgBPM: parseFloat(avgBPM),
      drowsinessCount: currentDrowsinessCount,
      alertnessRating: evaluateAlertness(parseFloat(avgBPM), currentDrowsinessCount)
    };

    history.unshift(sessionRecord); // Add newest first
    localStorage.setItem('driver_sessions', JSON.stringify(history));

    window.soundEngine.playStopCue();
    window.soundEngine.speak(`Drive session ended. Total blinks: ${currentSessionBlinks}. Average interval: ${avgInterval} seconds.`);

    // Reset UI state
    sessionState = 'IDLE';
    startBtn.disabled = false;
    startBtn.textContent = 'Start New Drive';
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    simulateBtn.disabled = true;
    cameraStatusText.textContent = 'Camera Inactive';
    cameraStatusText.className = 'status-badge status-inactive';

    showHistoryModal();
  }

  function startTimer() {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = setInterval(() => {
      sessionElapsedSeconds++;
      timerDisplay.textContent = formatTime(sessionElapsedSeconds);

      // Clean up rolling BPM window (older than 60s)
      const now = Date.now();
      recentBlinkTimestamps = recentBlinkTimestamps.filter(t => (now - t) < 60000);

      updateMetrics();

      // Periodic voice announcements (e.g. every 5 minutes)
      const currentMinute = Math.floor(sessionElapsedSeconds / 60);
      if (currentMinute > 0 && currentMinute % 5 === 0 && currentMinute !== lastVoiceReportMinute) {
        lastVoiceReportMinute = currentMinute;
        const avgBpm = ((currentSessionBlinks / sessionElapsedSeconds) * 60).toFixed(1);
        window.soundEngine.speak(`Drive session: ${currentMinute} minutes. Blink rate: ${avgBpm} per minute.`);
      }
    }, 1000);
  }

  function handleBlinkDetected(blinkData) {
    if (sessionState !== 'RUNNING') return;

    currentSessionBlinks++;
    currentSessionIntervals.push(blinkData.intervalSec);
    recentBlinkTimestamps.push(Date.now());

    window.soundEngine.playBlinkSound();

    // Visual pulse effect
    blinkCountDisplay.classList.add('blink-pulse');
    setTimeout(() => blinkCountDisplay.classList.remove('blink-pulse'), 150);

    updateMetrics();
  }

  function handleDrowsinessAlert(closedDuration) {
    if (sessionState !== 'RUNNING') return;

    currentDrowsinessCount++;
    drowsinessBanner.classList.remove('hidden');
    drowsinessBanner.textContent = `ALERT: EYES CLOSED FOR ${(closedDuration / 1000).toFixed(1)}s! WAKE UP!`;

    window.soundEngine.startDrowsinessAlarm();
    updateAlertnessBadge('CRITICAL DROWSINESS', 'status-danger');
  }

  function handleDrowsinessResolved() {
    drowsinessBanner.classList.add('hidden');
    window.soundEngine.stopDrowsinessAlarm();
    updateMetrics();
  }

  function handleEARUpdate(earData) {
    const ear = earData.ear;
    earCurrentVal.textContent = ear.toFixed(2);

    // Progress bar percent (range approx 0.05 to 0.40)
    const pct = Math.min(100, Math.max(0, (ear / 0.40) * 100));
    earProgressBar.style.width = `${pct}%`;

    if (ear < earData.threshold) {
      earProgressBar.style.backgroundColor = '#ef4444'; // Red (closed)
    } else {
      earProgressBar.style.backgroundColor = '#10b981'; // Green (open)
    }
  }

  function handleFaceStatus(hasFace) {
    if (!hasFace && sessionState === 'RUNNING') {
      cameraStatusText.textContent = 'Warning: Driver face not centered!';
      cameraStatusText.className = 'status-badge status-warning';
    } else if (hasFace && sessionState === 'RUNNING') {
      cameraStatusText.textContent = 'Driver Face Tracked';
      cameraStatusText.className = 'status-badge status-active';
    }
  }

  function updateMetrics() {
    blinkCountDisplay.textContent = currentSessionBlinks;

    // Average Blink Interval (e.g. "every 20s" as user described)
    if (currentSessionBlinks > 0 && sessionElapsedSeconds > 0) {
      const avgInterval = (sessionElapsedSeconds / currentSessionBlinks).toFixed(1);
      avgIntervalDisplay.textContent = `every ${avgInterval}s`;
    } else {
      avgIntervalDisplay.textContent = '--';
    }

    // Blinks Per Minute (BPM)
    let bpm = 0;
    if (sessionElapsedSeconds >= 60) {
      // Use rolling window for real-time accuracy after 1st minute
      bpm = recentBlinkTimestamps.length;
    } else if (sessionElapsedSeconds > 0) {
      bpm = Math.round((currentSessionBlinks / sessionElapsedSeconds) * 60);
    }
    bpmDisplay.textContent = `${bpm} BPM`;

    // Alertness Status Logic
    const status = evaluateAlertness(bpm, currentDrowsinessCount);
    updateAlertnessBadge(status.label, status.className);
  }

  function evaluateAlertness(bpm, drowsyCount) {
    if (drowsyCount > 2) {
      return { label: 'FATIGUE ALERT (DROWSY)', className: 'status-danger' };
    }
    if (sessionElapsedSeconds < 30) {
      return { label: 'CALIBRATING DRIVE...', className: 'status-info' };
    }
    if (bpm >= 10 && bpm <= 22) {
      return { label: 'PRO DRIVER (OPTIMAL FOCUS)', className: 'status-success' };
    }
    if (bpm < 7) {
      return { label: 'STARING / HIGHWAY HYPNOSIS', className: 'status-warning' };
    }
    if (bpm > 26) {
      return { label: 'HIGH BLINK RATE (EYE FATIGUE)', className: 'status-warning' };
    }
    return { label: 'ATTENTIVE DRIVER', className: 'status-success' };
  }

  function updateAlertnessBadge(text, className) {
    alertnessBadge.textContent = text;
    alertnessBadge.className = `alertness-pill ${className}`;
  }

  function updateUI() {
    blinkCountDisplay.textContent = currentSessionBlinks;
    timerDisplay.textContent = formatTime(sessionElapsedSeconds);
    avgIntervalDisplay.textContent = '--';
    bpmDisplay.textContent = '0 BPM';
    drowsinessBanner.classList.add('hidden');
    updateAlertnessBadge('INITIALIZING...', 'status-info');
  }

  function formatTime(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // --- Session History & Records Storage ---

  function getSessionHistory() {
    try {
      const data = localStorage.getItem('driver_sessions');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function showHistoryModal() {
    renderHistoryTable();
    historyModal.classList.remove('hidden');
  }

  function closeHistoryModal() {
    historyModal.classList.add('hidden');
  }

  historyBtn.addEventListener('click', showHistoryModal);
  closeHistoryBtn.addEventListener('click', closeHistoryModal);

  function renderHistoryTable() {
    const history = getSessionHistory();
    historyTableBody.innerHTML = '';

    if (history.length === 0) {
      emptyHistoryMsg.classList.remove('hidden');
      return;
    }

    emptyHistoryMsg.classList.add('hidden');
    history.forEach((rec) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-bold">${rec.id}</td>
        <td>${rec.date} ${rec.startTime}</td>
        <td>${rec.durationFormatted}</td>
        <td class="text-cyan font-bold">${rec.totalBlinks}</td>
        <td>every ${rec.avgIntervalSec}s</td>
        <td>${rec.avgBPM}</td>
        <td><span class="badge ${rec.alertnessRating.className}">${rec.alertnessRating.label}</span></td>
      `;
      historyTableBody.appendChild(tr);
    });
  }

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all saved session records?')) {
      localStorage.removeItem('driver_sessions');
      renderHistoryTable();
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    const history = getSessionHistory();
    if (history.length === 0) {
      alert('No sessions recorded yet.');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Session ID,Date,Start Time,Duration,Total Blinks,Avg Interval (s),Avg BPM,Drowsiness Alerts,Rating\n';

    history.forEach(r => {
      csvContent += `"${r.id}","${r.date}","${r.startTime}","${r.durationFormatted}",${r.totalBlinks},${r.avgIntervalSec},${r.avgBPM},${r.drowsinessCount},"${r.alertnessRating.label}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `driver_blink_records_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
