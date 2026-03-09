// ============================================================
// Audio Manager
// ============================================================
// Captures system audio via FFmpeg, runs FFT for frequency
// analysis, detects beats, and broadcasts to ESPs via UDP
// and to PWA clients via events.
// ============================================================

const EventEmitter = require('events');
const { spawn } = require('child_process');
const dgram = require('dgram');
const path = require('path');
const fs = require('fs');
const FFT = require('fft.js');

// Load audio config
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
let audioConfig = {};
try {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  audioConfig = config.audio || {};
} catch (_) {}

const FFMPEG_PATH = audioConfig.ffmpegPath || 'ffmpeg';
const AUDIO_DEVICE = audioConfig.device || 'Stereo Mix (Realtek(R) Audio)';
const SAMPLE_RATE = audioConfig.sampleRate || 44100;
const FFT_SIZE = audioConfig.fftSize || 1024;
const UDP_PORT = audioConfig.udpPort || 4210;
const BROADCAST_ADDR = audioConfig.broadcastAddr || '192.168.0.255';

class AudioManager extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.ffmpeg = null;
    this.udpSocket = null;

    // FFT
    this.fft = new FFT(FFT_SIZE);
    this.pcmBuffer = Buffer.alloc(0);
    this.bytesPerWindow = FFT_SIZE * 2; // 16-bit mono = 2 bytes/sample

    // Hann window (precomputed)
    this.hannWindow = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
    }

    // Beat detection state
    this.bassHistory = new Float32Array(43); // ~2s at 20Hz
    this.historyIdx = 0;
    this.beatCooldown = 0;
    this.sensitivity = 1.5;
    this.cooldownMs = 150;

    // Auto-gain
    this.runningMax = 0.01;
    this.maxDecay = 0.998; // Slow decay for stable auto-gain

    // Throttle output to ~20Hz
    this.lastEmit = 0;
    this.emitInterval = 50;

    // UDP sequence
    this.seqNum = 0;
  }

  start() {
    if (this.active) return;
    this.active = true;

    // Create UDP broadcast socket
    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.bind(() => {
      this.udpSocket.setBroadcast(true);
    });

    // Spawn ffmpeg: capture audio, output raw PCM to stdout
    const args = [
      '-f', 'dshow',
      '-i', `audio=${AUDIO_DEVICE}`,
      '-ac', '1',               // mono
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',            // signed 16-bit little-endian
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ];

    console.log(`[AudioManager] Starting: ${FFMPEG_PATH} (device: ${AUDIO_DEVICE})`);

    try {
      this.ffmpeg = spawn(FFMPEG_PATH, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      console.error('[AudioManager] Failed to spawn ffmpeg:', err.message);
      this.active = false;
      this.emit('stopped', { reason: 'spawn_error', error: err.message });
      return;
    }

    this.ffmpeg.stdout.on('data', (chunk) => this.onPcmData(chunk));

    this.ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      // ffmpeg logs all info to stderr; only log actual errors
      if (msg.includes('Error') || msg.includes('error') || msg.includes('No such')) {
        console.error('[AudioManager] ffmpeg:', msg.trim().substring(0, 200));
      }
    });

    this.ffmpeg.on('error', (err) => {
      console.error('[AudioManager] ffmpeg process error:', err.message);
      this.active = false;
      this.emit('stopped', { reason: 'ffmpeg_error', error: err.message });
    });

    this.ffmpeg.on('close', (code) => {
      if (this.active) {
        console.error('[AudioManager] ffmpeg exited with code', code);
        this.active = false;
        this.emit('stopped', { reason: 'ffmpeg_exit', code });
      }
    });

    console.log('[AudioManager] Audio capture started');
    this.emit('started');
  }

  stop() {
    this.active = false;
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
    }
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) {}
      this.udpSocket = null;
    }
    this.pcmBuffer = Buffer.alloc(0);
    this.bassHistory.fill(0);
    this.historyIdx = 0;
    this.runningMax = 0.01;
    this.seqNum = 0;
    console.log('[AudioManager] Stopped');
    this.emit('stopped', { reason: 'user' });
  }

  onPcmData(chunk) {
    this.pcmBuffer = Buffer.concat([this.pcmBuffer, chunk]);

    // Process complete FFT windows
    while (this.pcmBuffer.length >= this.bytesPerWindow) {
      // Extract samples (16-bit signed LE → float -1..1)
      const samples = new Float32Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        samples[i] = this.pcmBuffer.readInt16LE(i * 2) / 32768.0;
      }

      // Slide buffer by half window (50% overlap)
      this.pcmBuffer = this.pcmBuffer.subarray(FFT_SIZE);

      // Apply Hann window
      for (let i = 0; i < FFT_SIZE; i++) {
        samples[i] *= this.hannWindow[i];
      }

      // Run FFT
      const complexOut = this.fft.createComplexArray();
      this.fft.realTransform(complexOut, samples);
      this.fft.completeSpectrum(complexOut);

      // Compute magnitudes (first half = unique frequencies)
      const halfSize = FFT_SIZE / 2;
      const magnitudes = new Float32Array(halfSize);
      for (let i = 0; i < halfSize; i++) {
        const re = complexOut[2 * i];
        const im = complexOut[2 * i + 1];
        magnitudes[i] = Math.sqrt(re * re + im * im);
      }

      this.processSpectrum(magnitudes);
    }

    // Prevent unbounded buffer growth
    if (this.pcmBuffer.length > this.bytesPerWindow * 4) {
      this.pcmBuffer = this.pcmBuffer.subarray(this.pcmBuffer.length - this.bytesPerWindow);
    }
  }

  processSpectrum(magnitudes) {
    const now = Date.now();
    if (now - this.lastEmit < this.emitInterval) return;
    this.lastEmit = now;

    const binHz = SAMPLE_RATE / FFT_SIZE;
    const halfSize = magnitudes.length;

    // Frequency band boundaries (in bins)
    const bassEnd = Math.min(Math.ceil(250 / binHz), halfSize);
    const midEnd = Math.min(Math.ceil(4000 / binHz), halfSize);
    const trebleEnd = Math.min(Math.ceil(16000 / binHz), halfSize);

    // Sum energy per band
    let bass = 0, mid = 0, treble = 0;
    for (let i = 1; i < bassEnd; i++) bass += magnitudes[i];
    for (let i = bassEnd; i < midEnd; i++) mid += magnitudes[i];
    for (let i = midEnd; i < trebleEnd; i++) treble += magnitudes[i];

    // Normalize by bin count
    bass /= Math.max(bassEnd - 1, 1);
    mid /= Math.max(midEnd - bassEnd, 1);
    treble /= Math.max(trebleEnd - midEnd, 1);

    // Auto-gain with slow decay
    const peak = Math.max(bass, mid, treble);
    if (peak > this.runningMax) {
      this.runningMax = peak;
    } else {
      this.runningMax *= this.maxDecay;
      if (this.runningMax < 0.01) this.runningMax = 0.01;
    }

    // Scale to 0-1
    bass = Math.min(bass / this.runningMax, 1.0);
    mid = Math.min(mid / this.runningMax, 1.0);
    treble = Math.min(treble / this.runningMax, 1.0);

    // Beat detection: bass exceeds running average
    this.bassHistory[this.historyIdx % this.bassHistory.length] = bass;
    this.historyIdx++;

    let avgBass = 0;
    for (let i = 0; i < this.bassHistory.length; i++) avgBass += this.bassHistory[i];
    avgBass /= this.bassHistory.length;

    let beat = false;
    let beatIntensity = 0;
    if (bass > avgBass * this.sensitivity && bass > 0.3 && now > this.beatCooldown) {
      beat = true;
      beatIntensity = Math.min(1.0, (bass - avgBass) / Math.max(avgBass, 0.01));
      this.beatCooldown = now + this.cooldownMs;
    }

    // Dominant band
    const dominant = (bass >= mid && bass >= treble) ? 0
                   : (mid >= treble) ? 1 : 2;

    // 16-bin spectrum for PWA visualization (logarithmic-ish grouping)
    const spectrumBins = 16;
    const spectrum = new Array(spectrumBins);
    for (let i = 0; i < spectrumBins; i++) {
      // Exponential bin grouping: more resolution in low frequencies
      const startBin = Math.floor(Math.pow(i / spectrumBins, 2) * halfSize);
      const endBin = Math.floor(Math.pow((i + 1) / spectrumBins, 2) * halfSize);
      let sum = 0;
      const count = Math.max(endBin - startBin, 1);
      for (let j = startBin; j < endBin && j < halfSize; j++) {
        sum += magnitudes[j];
      }
      spectrum[i] = Math.min(sum / count / this.runningMax, 1.0);
    }

    const data = { bass, mid, treble, beat, beatIntensity, dominant, spectrum };

    // Emit to Hub (WebSocket broadcast)
    this.emit('audioData', data);

    // UDP broadcast to ESPs
    this.sendUdpBeat(data);
  }

  sendUdpBeat(data) {
    if (!this.udpSocket) return;

    const packet = Buffer.alloc(8);
    packet[0] = 0xBE; // Magic
    packet[1] = Math.round(data.bass * 255);
    packet[2] = Math.round(data.mid * 255);
    packet[3] = Math.round(data.treble * 255);
    packet[4] = data.beat ? 0x01 : 0x00;
    packet[5] = Math.round(data.beatIntensity * 255);
    packet[6] = data.dominant;
    packet[7] = this.seqNum++ & 0xFF;

    this.udpSocket.send(packet, 0, 8, UDP_PORT, BROADCAST_ADDR);
  }

  getStatus() {
    return {
      active: this.active,
      device: AUDIO_DEVICE,
      sensitivity: this.sensitivity,
      cooldownMs: this.cooldownMs,
      udpPort: UDP_PORT,
      broadcastAddr: BROADCAST_ADDR,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE
    };
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(1.0, Math.min(3.0, value));
  }
}

module.exports = AudioManager;
