// ============================================================
// Animation Manager
// ============================================================
// Manages keyframe-based LED animations. Stores named animation
// presets (keyframe sequences) and uploads them to ESP devices
// via /api/animation/keyframe. Controls playback (play/stop/loop)
// via /api/animation. Persists saved animations to JSON file.
//
// Animation format:
//   { name, duration, keyframes: [{ time, leds: [{r,g,b}, ...] }] }
//
// Device-specific: Clock=60 LEDs, Lamp=24 LEDs.
// Keyframes are stored normalized (per-LED RGB array) and
// converted to hex strings for firmware upload.
// ============================================================

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'animations.json');
const MAX_KEYFRAMES_CLOCK = 12;  // 60 LEDs * 3 = 180 bytes/kf
const MAX_KEYFRAMES_LAMP = 28;   // 24 LEDs * 3 = 72 bytes/kf
const LED_COUNT_CLOCK = 60;
const LED_COUNT_LAMP = 24;

class AnimationManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.dm = deviceManager;
    this.animations = {};  // name -> animation object
    this.playing = {};     // deviceId -> animation name (currently playing)
    this._load();
  }

  // ---- Saved Animations CRUD ----

  /**
   * Save a named animation
   * @param {string} name - Unique animation name
   * @param {object} anim - { duration, loop, keyframes: [{ time, leds: [{r,g,b},...] }] }
   */
  saveAnimation(name, anim) {
    if (!name || !anim || !anim.keyframes || anim.keyframes.length < 2) {
      throw new Error('Animation needs a name and at least 2 keyframes');
    }
    this.animations[name] = {
      name,
      duration: anim.duration || anim.keyframes[anim.keyframes.length - 1].time || 2000,
      loop: anim.loop !== false,
      keyframes: anim.keyframes,
      createdAt: this.animations[name]?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    this._save();
    this.emit('animationSaved', { name });
    console.log(`[AnimationManager] Saved "${name}" (${anim.keyframes.length} keyframes)`);
    return this.animations[name];
  }

  deleteAnimation(name) {
    if (!this.animations[name]) return false;
    delete this.animations[name];
    this._save();
    this.emit('animationDeleted', { name });
    console.log(`[AnimationManager] Deleted "${name}"`);
    return true;
  }

  getAnimation(name) {
    return this.animations[name] || null;
  }

  listAnimations() {
    return Object.values(this.animations).map(a => ({
      name: a.name,
      duration: a.duration,
      loop: a.loop,
      keyframeCount: a.keyframes.length,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    }));
  }

  // ---- Upload & Playback ----

  /**
   * Upload animation keyframes to a device and start playback
   * @param {string} name - Animation name (from saved animations)
   * @param {string} deviceId - Target device ID
   * @param {object} opts - { loop: bool }
   */
  async playAnimation(name, deviceId, opts = {}) {
    const anim = this.animations[name];
    if (!anim) throw new Error(`Animation "${name}" not found`);

    const device = this.dm.get(deviceId);
    if (!device || !device.online) throw new Error(`Device "${deviceId}" not available`);

    const ledCount = this._ledCountForDevice(device);
    const maxKf = ledCount === 60 ? MAX_KEYFRAMES_CLOCK : MAX_KEYFRAMES_LAMP;

    if (anim.keyframes.length > maxKf) {
      throw new Error(`Too many keyframes (${anim.keyframes.length} > ${maxKf})`);
    }

    // Clear existing animation on device
    await this.dm.sendCommand(deviceId, '/api/animation', { action: 'clear' });

    // Upload each keyframe
    for (let i = 0; i < anim.keyframes.length; i++) {
      const kf = anim.keyframes[i];
      const hexData = this._keyframeToHex(kf, ledCount);
      await this.dm.sendCommand(deviceId, '/api/animation/keyframe', {
        idx: i,
        t: kf.time,
        d: hexData
      });
    }

    // Set mode to custom and start playback
    await this.dm.sendCommand(deviceId, '/api/pattern', { mode: 'custom' });
    const loop = opts.loop !== undefined ? opts.loop : anim.loop;
    await this.dm.sendCommand(deviceId, '/api/animation', {
      action: 'play',
      loop: loop ? 'true' : 'false'
    });

    this.playing[deviceId] = name;
    this.emit('animationPlaying', { name, deviceId });
    console.log(`[AnimationManager] Playing "${name}" on ${deviceId}`);
    return { ok: true, name, deviceId, keyframes: anim.keyframes.length };
  }

  /**
   * Stop animation on a device and revert to a normal pattern
   */
  async stopAnimation(deviceId, revertMode = 'candle') {
    try {
      await this.dm.sendCommand(deviceId, '/api/animation', { action: 'stop' });
      await this.dm.sendCommand(deviceId, '/api/pattern', { mode: revertMode });
    } catch (e) {
      console.error(`[AnimationManager] Stop failed on ${deviceId}: ${e.message}`);
    }
    delete this.playing[deviceId];
    this.emit('animationStopped', { deviceId });
  }

  /**
   * Upload and play animation on ALL online devices with animation capability
   */
  async playOnAll(name, opts = {}) {
    const devices = this.dm.getAll()
      .filter(d => d.online && d.capabilities && d.capabilities.includes('animations'));
    const results = {};
    for (const dev of devices) {
      try {
        results[dev.id] = await this.playAnimation(name, dev.id, opts);
      } catch (e) {
        results[dev.id] = { ok: false, error: e.message };
      }
    }
    return results;
  }

  /**
   * Stop animation on all devices
   */
  async stopAll(revertMode = 'candle') {
    const ids = Object.keys(this.playing);
    for (const id of ids) {
      await this.stopAnimation(id, revertMode);
    }
  }

  // ---- Built-in Preset Animations ----

  /**
   * Generate preset animations (called on first run to seed defaults)
   */
  _generatePresets() {
    // Preset 1: Color Cycle (red → green → blue → red, 6s loop)
    this.saveAnimation('Color Cycle', {
      duration: 6000,
      loop: true,
      keyframes: [
        { time: 0,    leds: 'solid', r: 255, g: 0, b: 0 },
        { time: 2000, leds: 'solid', r: 0, g: 255, b: 0 },
        { time: 4000, leds: 'solid', r: 0, g: 0, b: 255 },
        { time: 6000, leds: 'solid', r: 255, g: 0, b: 0 }
      ]
    });

    // Preset 2: Warm Breathe (warm white fade in/out, 4s loop)
    this.saveAnimation('Warm Breathe', {
      duration: 4000,
      loop: true,
      keyframes: [
        { time: 0,    leds: 'solid', r: 0, g: 0, b: 0 },
        { time: 1000, leds: 'solid', r: 255, g: 180, b: 80 },
        { time: 3000, leds: 'solid', r: 255, g: 180, b: 80 },
        { time: 4000, leds: 'solid', r: 0, g: 0, b: 0 }
      ]
    });

    // Preset 3: Police Lights (red/blue alternating, 2s loop)
    this.saveAnimation('Police Lights', {
      duration: 2000,
      loop: true,
      keyframes: [
        { time: 0,    leds: 'solid', r: 255, g: 0, b: 0 },
        { time: 250,  leds: 'solid', r: 0, g: 0, b: 0 },
        { time: 500,  leds: 'solid', r: 255, g: 0, b: 0 },
        { time: 750,  leds: 'solid', r: 0, g: 0, b: 0 },
        { time: 1000, leds: 'solid', r: 0, g: 0, b: 255 },
        { time: 1250, leds: 'solid', r: 0, g: 0, b: 0 },
        { time: 1500, leds: 'solid', r: 0, g: 0, b: 255 },
        { time: 1750, leds: 'solid', r: 0, g: 0, b: 0 }
      ]
    });
  }

  // ---- Helpers ----

  /**
   * Get LED count for a device based on its status
   */
  _ledCountForDevice(device) {
    if (device.status && device.status.ledCount) return device.status.ledCount;
    if (device.id === 'lamp') return LED_COUNT_LAMP;
    return LED_COUNT_CLOCK;  // Default: clock
  }

  /**
   * Convert a keyframe to hex string for firmware upload
   * Handles both explicit per-LED arrays and 'solid' color shorthand
   * @param {object} kf - Keyframe { time, leds: [{r,g,b},...] | 'solid', r, g, b }
   * @param {number} ledCount - Number of LEDs on target device
   * @returns {string} Hex-encoded RGB data
   */
  _keyframeToHex(kf, ledCount) {
    let hex = '';
    if (kf.leds === 'solid') {
      // Solid color shorthand: fill all LEDs with same color
      const r = (kf.r || 0).toString(16).padStart(2, '0');
      const g = (kf.g || 0).toString(16).padStart(2, '0');
      const b = (kf.b || 0).toString(16).padStart(2, '0');
      const pixel = r + g + b;
      for (let i = 0; i < ledCount; i++) hex += pixel;
    } else if (Array.isArray(kf.leds)) {
      // Per-LED color array
      for (let i = 0; i < ledCount; i++) {
        const led = kf.leds[i] || { r: 0, g: 0, b: 0 };
        hex += (led.r || 0).toString(16).padStart(2, '0');
        hex += (led.g || 0).toString(16).padStart(2, '0');
        hex += (led.b || 0).toString(16).padStart(2, '0');
      }
    } else {
      // Fallback: black
      hex = '000000'.repeat(ledCount);
    }
    return hex;
  }

  // ---- Persistence ----

  _save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.animations, null, 2));
    } catch (e) {
      console.error('[AnimationManager] Save failed:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        this.animations = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        console.log(`[AnimationManager] Loaded ${Object.keys(this.animations).length} animations`);
      } else {
        console.log('[AnimationManager] No saved animations, generating presets');
        this._generatePresets();
      }
    } catch (e) {
      console.error('[AnimationManager] Load failed:', e.message);
      this._generatePresets();
    }
  }

  getStatus() {
    return {
      animations: this.listAnimations(),
      playing: { ...this.playing }
    };
  }
}

module.exports = AnimationManager;
