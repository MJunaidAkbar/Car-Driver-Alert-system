/**
 * audio.js - Web Audio API Synthesizer & Speech Voice Alerts for DriverBlink
 * Operates completely offline without external audio files.
 */

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.alarmOscillator = null;
    this.alarmGain = null;
    this.alarmInterval = null;
    this.isAlarmPlaying = false;
    this.soundEffectsEnabled = true;
    this.voiceAlertsEnabled = true;
    this.voiceIntervalMinutes = 5;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playBlinkSound() {
    if (!this.soundEffectsEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, this.audioCtx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.045);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  playStartCue() {
    if (!this.soundEffectsEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    const notes = [440, 554.37, 659.25]; // A4, C#5, E5
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const startTime = this.audioCtx.currentTime + idx * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.13);
    });
  }

  playStopCue() {
    if (!this.soundEffectsEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    const notes = [659.25, 554.37, 440]; // E5, C#5, A4
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const startTime = this.audioCtx.currentTime + idx * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.13);
    });
  }

  startDrowsinessAlarm() {
    if (this.isAlarmPlaying) return;
    this.init();
    if (!this.audioCtx) return;

    this.isAlarmPlaying = true;
    let high = false;

    // Pulse urgent loud warning buzzer
    const pulse = () => {
      if (!this.isAlarmPlaying) return;
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(high ? 1300 : 950, this.audioCtx.currentTime);
        high = !high;

        gain.gain.setValueAtTime(0.45, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.18);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.19);
      } catch (e) {
        console.warn('Alarm error:', e);
      }
    };

    pulse();
    this.alarmInterval = setInterval(pulse, 220);

    // Speak urgent warning once
    this.speak('Attention! Wake up, eyes closed!');
  }

  stopDrowsinessAlarm() {
    if (!this.isAlarmPlaying) return;
    this.isAlarmPlaying = false;
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }

  speak(text, interrupt = true) {
    if (!this.voiceAlertsEnabled) return;
    if (!('speechSynthesis' in window)) return;

    try {
      if (interrupt) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }
}

window.soundEngine = new SoundEngine();
