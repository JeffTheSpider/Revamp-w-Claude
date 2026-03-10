// ============================================================
// CircadianManager Unit Tests
// ============================================================
// Tests the Kelvin calculation curve at various times of day,
// sunrise alarm scheduling, and start/stop lifecycle.
// ============================================================

describe('CircadianManager', () => {
  let CircadianManager;
  let dm;
  let cm;

  beforeEach(() => {
    // Clear module cache for fresh require each test
    delete require.cache[require.resolve('../../src/services/circadian-manager')];
    CircadianManager = require('../../src/services/circadian-manager');

    dm = {
      get: jest.fn(),
      getAll: jest.fn(() => []),
      sendCommand: jest.fn(() => Promise.resolve())
    };

    cm = new CircadianManager(dm);
  });

  afterEach(() => {
    // Ensure timers are cleaned up
    cm.stop();
  });

  // ---- Kelvin Calculation ----

  describe('getCircadianKelvin()', () => {
    // Helper to mock Date for a specific hour:minute
    function mockTime(hour, minute) {
      jest.spyOn(global, 'Date').mockImplementation(() => ({
        getHours: () => hour,
        getMinutes: () => minute
      }));
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('returns 2700K at midnight (0:00)', () => {
      mockTime(0, 0);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('returns 2700K at 3:00 AM (middle of night)', () => {
      mockTime(3, 0);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('returns 2700K at 5:59 AM (just before morning ramp)', () => {
      mockTime(5, 59);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('returns 2700K at exactly 6:00 AM (start of ramp)', () => {
      // totalMin = 360, falls into range [360, 480)
      // 2700 + (360 - 360) * 2300 / 120 = 2700
      mockTime(6, 0);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('returns ~3850K at 7:00 AM (mid morning ramp)', () => {
      // totalMin = 420 => 2700 + (420-360)*2300/120 = 2700 + 1150 = 3850
      mockTime(7, 0);
      expect(cm.getCircadianKelvin()).toBe(3850);
    });

    test('returns 5000K at 8:00 AM (end of morning ramp)', () => {
      // totalMin = 480 falls into [480, 720) range
      // 5000 + (480-480)*1500/240 = 5000
      mockTime(8, 0);
      expect(cm.getCircadianKelvin()).toBe(5000);
    });

    test('returns ~5750K at 10:00 AM (mid morning brightening)', () => {
      // totalMin = 600 => 5000 + (600-480)*1500/240 = 5000 + 750 = 5750
      mockTime(10, 0);
      expect(cm.getCircadianKelvin()).toBe(5750);
    });

    test('returns 6500K at 12:00 PM (peak)', () => {
      // totalMin = 720, falls into [720, 960) range
      // 6500 - (720-720)*1500/240 = 6500
      mockTime(12, 0);
      expect(cm.getCircadianKelvin()).toBe(6500);
    });

    test('returns ~5750K at 2:00 PM (afternoon decline)', () => {
      // totalMin = 840 => 6500 - (840-720)*1500/240 = 6500 - 750 = 5750
      mockTime(14, 0);
      expect(cm.getCircadianKelvin()).toBe(5750);
    });

    test('returns 5000K at 4:00 PM (start of evening)', () => {
      // totalMin = 960, falls into [960, 1260) range
      // 5000 - (960-960)*2300/300 = 5000
      mockTime(16, 0);
      expect(cm.getCircadianKelvin()).toBe(5000);
    });

    test('returns ~3850K at 6:30 PM', () => {
      // totalMin = 1110 => 5000 - (1110-960)*2300/300 = 5000 - 1150 = 3850
      // (1110-960) = 150, 150*2300/300 = 1150
      mockTime(18, 30);
      expect(cm.getCircadianKelvin()).toBe(3850);
    });

    test('returns 2700K at 9:00 PM (21:00)', () => {
      // totalMin = 1260, falls into >= 1260 range => 2700
      mockTime(21, 0);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('returns 2700K at 11:30 PM (late night)', () => {
      mockTime(23, 30);
      expect(cm.getCircadianKelvin()).toBe(2700);
    });

    test('Kelvin is monotonically increasing from 6:00 to 12:00', () => {
      let prev = 0;
      for (let h = 6; h <= 12; h++) {
        mockTime(h, 0);
        const k = cm.getCircadianKelvin();
        expect(k).toBeGreaterThanOrEqual(prev);
        prev = k;
        jest.restoreAllMocks();
      }
    });

    test('Kelvin is monotonically decreasing from 12:00 to 21:00', () => {
      let prev = Infinity;
      for (let h = 12; h <= 21; h++) {
        mockTime(h, 0);
        const k = cm.getCircadianKelvin();
        expect(k).toBeLessThanOrEqual(prev);
        prev = k;
        jest.restoreAllMocks();
      }
    });
  });

  // ---- Start / Stop ----

  describe('start() / stop()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('start() sets enabled to true', () => {
      cm.start();
      expect(cm.enabled).toBe(true);
    });

    test('start() emits started event', () => {
      const handler = jest.fn();
      cm.on('started', handler);
      cm.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('start() sets currentKelvin', () => {
      cm.start();
      expect(cm.currentKelvin).toBeGreaterThanOrEqual(2700);
      expect(cm.currentKelvin).toBeLessThanOrEqual(6500);
    });

    test('start() is idempotent (calling twice does not duplicate timers)', () => {
      cm.start();
      cm.start();
      expect(cm.enabled).toBe(true);
    });

    test('stop() sets enabled to false', () => {
      cm.start();
      cm.stop();
      expect(cm.enabled).toBe(false);
    });

    test('stop() emits stopped event', () => {
      const handler = jest.fn();
      cm.on('stopped', handler);
      cm.start();
      cm.stop();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('stop() is safe to call when not started', () => {
      expect(() => cm.stop()).not.toThrow();
    });
  });

  // ---- Sunrise Alarms ----

  describe('setSunriseAlarm()', () => {
    test('adds an alarm', () => {
      cm.setSunriseAlarm(7, 30, ['mirror']);
      expect(cm.sunriseAlarms).toHaveLength(1);
      expect(cm.sunriseAlarms[0].hour).toBe(7);
      expect(cm.sunriseAlarms[0].minute).toBe(30);
      expect(cm.sunriseAlarms[0].deviceIds).toEqual(['mirror']);
    });

    test('emits alarmSet event', () => {
      const handler = jest.fn();
      cm.on('alarmSet', handler);
      cm.setSunriseAlarm(8, 0, []);
      expect(handler).toHaveBeenCalledWith({ hour: 8, minute: 0, deviceIds: [] });
    });

    test('replaces existing alarm at same time', () => {
      cm.setSunriseAlarm(7, 0, ['mirror']);
      cm.setSunriseAlarm(7, 0, ['lamp']);
      expect(cm.sunriseAlarms).toHaveLength(1);
      expect(cm.sunriseAlarms[0].deviceIds).toEqual(['lamp']);
    });

    test('allows multiple alarms at different times', () => {
      cm.setSunriseAlarm(6, 0, ['mirror']);
      cm.setSunriseAlarm(7, 30, ['lamp']);
      expect(cm.sunriseAlarms).toHaveLength(2);
    });
  });

  describe('removeSunriseAlarm()', () => {
    test('removes an existing alarm and returns true', () => {
      cm.setSunriseAlarm(8, 0, ['mirror']);
      const result = cm.removeSunriseAlarm(8, 0);
      expect(result).toBe(true);
      expect(cm.sunriseAlarms).toHaveLength(0);
    });

    test('returns false when no matching alarm exists', () => {
      const result = cm.removeSunriseAlarm(12, 0);
      expect(result).toBe(false);
    });

    test('does not remove alarms at other times', () => {
      cm.setSunriseAlarm(6, 0, []);
      cm.setSunriseAlarm(7, 0, []);
      cm.removeSunriseAlarm(6, 0);
      expect(cm.sunriseAlarms).toHaveLength(1);
      expect(cm.sunriseAlarms[0].hour).toBe(7);
    });
  });

  // ---- getStatus() ----

  describe('getStatus()', () => {
    test('returns status with enabled false when not started', () => {
      const status = cm.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.currentKelvin).toBeNull();
      expect(status.alarms).toEqual([]);
    });

    test('returns current kelvin when started', () => {
      cm.start();
      const status = cm.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.currentKelvin).toBeGreaterThanOrEqual(2700);
    });

    test('formats alarm times correctly', () => {
      cm.setSunriseAlarm(7, 5, ['mirror', 'lamp']);
      const status = cm.getStatus();
      expect(status.alarms).toHaveLength(1);
      expect(status.alarms[0].time).toBe('7:05');
      expect(status.alarms[0].devices).toEqual(['mirror', 'lamp']);
    });
  });
});
