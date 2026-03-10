// ============================================================
// AnimationManager Unit Tests
// ============================================================
// Tests keyframe conversion to hex, save/load/delete CRUD,
// validation logic, and LED count detection.
// ============================================================

const fs = require('fs');
const path = require('path');

describe('AnimationManager', () => {
  let AnimationManager;
  let dm;
  let am;
  let dataFile;

  beforeEach(() => {
    dataFile = path.join(
      path.dirname(require.resolve('../../src/services/animation-manager')),
      '..', '..', 'animations.json'
    );

    dm = {
      get: jest.fn(),
      getAll: jest.fn(() => []),
      sendCommand: jest.fn(() => Promise.resolve({ ok: true }))
    };

    // Remove data file and clear module cache for fresh state
    try { fs.unlinkSync(dataFile); } catch (_) {}
    delete require.cache[require.resolve('../../src/services/animation-manager')];
    AnimationManager = require('../../src/services/animation-manager');

    am = new AnimationManager(dm);
  });

  afterEach(() => {
    // Clean up data file
    try { fs.unlinkSync(dataFile); } catch (_) {}
  });

  // ---- Keyframe to Hex Conversion ----

  describe('_keyframeToHex()', () => {
    test('converts solid color keyframe for 24 LEDs', () => {
      const kf = { time: 0, leds: 'solid', r: 255, g: 0, b: 128 };
      const hex = am._keyframeToHex(kf, 24);
      // Each pixel = "ff0080", 24 pixels
      expect(hex).toBe('ff0080'.repeat(24));
      expect(hex.length).toBe(24 * 6); // 6 hex chars per pixel
    });

    test('converts solid color keyframe for 60 LEDs', () => {
      const kf = { time: 0, leds: 'solid', r: 0, g: 255, b: 0 };
      const hex = am._keyframeToHex(kf, 60);
      expect(hex).toBe('00ff00'.repeat(60));
      expect(hex.length).toBe(60 * 6);
    });

    test('converts solid black (all zeros)', () => {
      const kf = { time: 0, leds: 'solid', r: 0, g: 0, b: 0 };
      const hex = am._keyframeToHex(kf, 4);
      expect(hex).toBe('000000'.repeat(4));
    });

    test('converts per-LED array keyframe', () => {
      const kf = {
        time: 0,
        leds: [
          { r: 255, g: 0, b: 0 },
          { r: 0, g: 255, b: 0 },
          { r: 0, g: 0, b: 255 }
        ]
      };
      const hex = am._keyframeToHex(kf, 3);
      expect(hex).toBe('ff0000' + '00ff00' + '0000ff');
    });

    test('pads missing LEDs with black when array is shorter than ledCount', () => {
      const kf = {
        time: 0,
        leds: [{ r: 255, g: 255, b: 255 }]
      };
      const hex = am._keyframeToHex(kf, 3);
      // First pixel white, next 2 black (defaults from || {r:0,g:0,b:0})
      expect(hex).toBe('ffffff' + '000000' + '000000');
    });

    test('handles missing r/g/b in per-LED array (defaults to 0)', () => {
      const kf = {
        time: 0,
        leds: [{ r: 128 }] // g and b missing
      };
      const hex = am._keyframeToHex(kf, 1);
      expect(hex).toBe('800000');
    });

    test('falls back to all black when leds is neither solid nor array', () => {
      const kf = { time: 0, leds: undefined };
      const hex = am._keyframeToHex(kf, 4);
      expect(hex).toBe('000000'.repeat(4));
    });

    test('pads single-digit hex values with leading zero', () => {
      const kf = { time: 0, leds: 'solid', r: 1, g: 2, b: 3 };
      const hex = am._keyframeToHex(kf, 1);
      expect(hex).toBe('010203');
    });
  });

  // ---- _ledCountForDevice() ----

  describe('_ledCountForDevice()', () => {
    test('returns ledCount from device status when available', () => {
      const device = { id: 'mirror', status: { ledCount: 60 } };
      expect(am._ledCountForDevice(device)).toBe(60);
    });

    test('returns 24 for lamp when no ledCount in status', () => {
      const device = { id: 'lamp', status: {} };
      expect(am._ledCountForDevice(device)).toBe(24);
    });

    test('defaults to 60 (clock) for unknown devices', () => {
      const device = { id: 'other', status: {} };
      expect(am._ledCountForDevice(device)).toBe(60);
    });

    test('returns 24 for lamp when status is null', () => {
      const device = { id: 'lamp', status: null };
      expect(am._ledCountForDevice(device)).toBe(24);
    });
  });

  // ---- saveAnimation() ----

  describe('saveAnimation()', () => {
    const validAnim = {
      duration: 2000,
      loop: true,
      keyframes: [
        { time: 0, leds: 'solid', r: 255, g: 0, b: 0 },
        { time: 2000, leds: 'solid', r: 0, g: 0, b: 255 }
      ]
    };

    test('saves an animation and returns it', () => {
      const result = am.saveAnimation('test', validAnim);
      expect(result.name).toBe('test');
      expect(result.duration).toBe(2000);
      expect(result.loop).toBe(true);
      expect(result.keyframes).toHaveLength(2);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    test('throws when name is empty', () => {
      expect(() => am.saveAnimation('', validAnim)).toThrow('Animation needs a name');
    });

    test('throws when keyframes is missing', () => {
      expect(() => am.saveAnimation('test', { duration: 1000 })).toThrow('at least 2 keyframes');
    });

    test('throws when fewer than 2 keyframes', () => {
      expect(() => am.saveAnimation('test', {
        keyframes: [{ time: 0, leds: 'solid', r: 0, g: 0, b: 0 }]
      })).toThrow('at least 2 keyframes');
    });

    test('defaults loop to true', () => {
      const result = am.saveAnimation('test', {
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 1000, leds: 'solid', r: 255, g: 255, b: 255 }
        ]
      });
      expect(result.loop).toBe(true);
    });

    test('respects loop: false', () => {
      const result = am.saveAnimation('test', {
        loop: false,
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 1000, leds: 'solid', r: 255, g: 255, b: 255 }
        ]
      });
      expect(result.loop).toBe(false);
    });

    test('uses last keyframe time as duration if not specified', () => {
      const result = am.saveAnimation('test', {
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 3000, leds: 'solid', r: 255, g: 255, b: 255 }
        ]
      });
      expect(result.duration).toBe(3000);
    });

    test('preserves createdAt on update', () => {
      const first = am.saveAnimation('test', validAnim);
      const createdAt = first.createdAt;
      const second = am.saveAnimation('test', validAnim);
      expect(second.createdAt).toBe(createdAt);
    });

    test('persists to file', () => {
      am.saveAnimation('persisted', validAnim);
      expect(fs.existsSync(dataFile)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      expect(saved.persisted).toBeDefined();
    });

    test('emits animationSaved event', () => {
      const handler = jest.fn();
      am.on('animationSaved', handler);
      am.saveAnimation('test', validAnim);
      expect(handler).toHaveBeenCalledWith({ name: 'test' });
    });
  });

  // ---- deleteAnimation() ----

  describe('deleteAnimation()', () => {
    const validAnim = {
      keyframes: [
        { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
        { time: 1000, leds: 'solid', r: 255, g: 0, b: 0 }
      ]
    };

    test('deletes existing animation and returns true', () => {
      am.saveAnimation('del', validAnim);
      expect(am.deleteAnimation('del')).toBe(true);
      expect(am.getAnimation('del')).toBeNull();
    });

    test('returns false for non-existent animation', () => {
      expect(am.deleteAnimation('nope')).toBe(false);
    });

    test('emits animationDeleted event', () => {
      const handler = jest.fn();
      am.on('animationDeleted', handler);
      am.saveAnimation('del', validAnim);
      am.deleteAnimation('del');
      expect(handler).toHaveBeenCalledWith({ name: 'del' });
    });
  });

  // ---- getAnimation() ----

  describe('getAnimation()', () => {
    test('returns null for unknown name', () => {
      expect(am.getAnimation('unknown')).toBeNull();
    });

    test('returns saved animation', () => {
      am.saveAnimation('test', {
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 1000, leds: 'solid', r: 255, g: 0, b: 0 }
        ]
      });
      const result = am.getAnimation('test');
      expect(result.name).toBe('test');
      expect(result.keyframes).toHaveLength(2);
    });
  });

  // ---- listAnimations() ----

  describe('listAnimations()', () => {
    test('returns summary of all animations', () => {
      am.saveAnimation('a', {
        duration: 1000,
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 1000, leds: 'solid', r: 255, g: 0, b: 0 }
        ]
      });
      am.saveAnimation('b', {
        duration: 2000,
        keyframes: [
          { time: 0, leds: 'solid', r: 0, g: 0, b: 0 },
          { time: 1000, leds: 'solid', r: 0, g: 255, b: 0 },
          { time: 2000, leds: 'solid', r: 0, g: 0, b: 255 }
        ]
      });

      const list = am.listAnimations();
      // 3 presets + 2 custom = 5
      expect(list).toHaveLength(5);
      const names = list.map(a => a.name);
      expect(names).toContain('a');
      expect(names).toContain('b');
      // Verify summary shape (no full keyframe data)
      const entry = list.find(a => a.name === 'a');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('duration');
      expect(entry).toHaveProperty('loop');
      expect(entry).toHaveProperty('keyframeCount');
      expect(entry).toHaveProperty('createdAt');
      expect(entry).toHaveProperty('updatedAt');
      expect(entry.keyframes).toBeUndefined();
    });
  });

  // ---- Presets on first load ----

  describe('preset generation', () => {
    test('generates presets when no data file exists', () => {
      // The beforeEach already removes the file, so am was constructed fresh
      // and _generatePresets() should have been called
      const list = am.listAnimations();
      expect(list.length).toBeGreaterThanOrEqual(3);
      const names = list.map(a => a.name);
      expect(names).toContain('Color Cycle');
      expect(names).toContain('Warm Breathe');
      expect(names).toContain('Police Lights');
    });
  });

  // ---- getStatus() ----

  describe('getStatus()', () => {
    test('returns animations list and playing map', () => {
      const status = am.getStatus();
      expect(status).toHaveProperty('animations');
      expect(status).toHaveProperty('playing');
      expect(Array.isArray(status.animations)).toBe(true);
      expect(typeof status.playing).toBe('object');
    });

    test('playing is empty initially', () => {
      expect(am.getStatus().playing).toEqual({});
    });
  });

  // ---- Persistence round-trip ----

  describe('persistence', () => {
    test('saved animation survives reload', () => {
      am.saveAnimation('persist-test', {
        duration: 5000,
        loop: false,
        keyframes: [
          { time: 0, leds: 'solid', r: 10, g: 20, b: 30 },
          { time: 5000, leds: 'solid', r: 100, g: 200, b: 255 }
        ]
      });

      // Create new instance (simulates restart)
      delete require.cache[require.resolve('../../src/services/animation-manager')];
      const AM2 = require('../../src/services/animation-manager');
      const am2 = new AM2(dm);

      const loaded = am2.getAnimation('persist-test');
      expect(loaded).not.toBeNull();
      expect(loaded.name).toBe('persist-test');
      expect(loaded.duration).toBe(5000);
      expect(loaded.loop).toBe(false);
      expect(loaded.keyframes).toHaveLength(2);
    });

    test('handles corrupt file gracefully (falls back to presets)', () => {
      fs.writeFileSync(dataFile, 'NOT VALID JSON {{{{');
      delete require.cache[require.resolve('../../src/services/animation-manager')];
      const AM2 = require('../../src/services/animation-manager');
      const am2 = new AM2(dm);

      // Should have preset animations (from _generatePresets fallback)
      const list = am2.listAnimations();
      expect(list.length).toBeGreaterThanOrEqual(3);
    });
  });
});
