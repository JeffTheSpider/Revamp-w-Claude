// ============================================================
// NotificationManager Unit Tests
// ============================================================
// Tests notification routing, profiles, history, API key
// validation, and weather notification mapping.
// Mocks fs and deviceManager.
// ============================================================

const fs = require('fs');
jest.mock('fs');

// Stable mock for crypto.randomBytes so API key generation is predictable
const crypto = require('crypto');
const MOCK_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from(MOCK_KEY, 'hex'));

let NotificationManager;

beforeAll(() => {
  // Default: no file on disk (first-run path)
  fs.existsSync.mockReturnValue(false);
  fs.writeFileSync.mockImplementation(() => {});
  fs.readFileSync.mockReturnValue('{}');
  NotificationManager = require('../src/services/notification-manager');
});

afterEach(() => {
  jest.clearAllMocks();
  // Re-mock randomBytes after clearAllMocks (spies get cleared)
  jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from(MOCK_KEY, 'hex'));
});

// ---- Mock DeviceManager ----

function makeMockDm(devices = []) {
  return {
    getAll: jest.fn(() => devices),
    sendCommand: jest.fn(() => Promise.resolve({ ok: true })),
    sendPost: jest.fn(() => Promise.resolve({ ok: true }))
  };
}

// ---- Tests ----

describe('NotificationManager', () => {
  let dm;
  let nm;

  beforeEach(() => {
    dm = makeMockDm([
      { id: 'mirror', ip: '192.168.0.201', online: true, capabilities: ['color', 'notify'] },
      { id: 'lamp', ip: '192.168.0.202', online: true, capabilities: ['color', 'notify'] }
    ]);

    fs.existsSync.mockReturnValue(false);
    nm = new NotificationManager(dm);
  });

  // ---- Constructor ----

  describe('constructor', () => {
    test('is an EventEmitter', () => {
      const EventEmitter = require('events');
      expect(nm).toBeInstanceOf(EventEmitter);
    });

    test('generates an API key on first run', () => {
      expect(nm.apiKey).toBeDefined();
      expect(typeof nm.apiKey).toBe('string');
      expect(nm.apiKey.length).toBeGreaterThan(0);
    });

    test('seeds default profiles on first run', () => {
      const profiles = nm.getProfiles();
      expect(profiles.alert).toBeDefined();
      expect(profiles.info).toBeDefined();
      expect(profiles.success).toBeDefined();
    });

    test('alert profile has red flash pattern', () => {
      const alert = nm.getProfiles().alert;
      expect(alert.r).toBe(255);
      expect(alert.g).toBe(0);
      expect(alert.b).toBe(0);
      expect(alert.pattern).toBe('flash');
    });

    test('loads from file when it exists', () => {
      const savedData = {
        profiles: { custom: { r: 100, g: 200, b: 50, pattern: 'pulse', duration: 2000, priority: 1 } },
        apiKey: 'saved-api-key-123',
        weather: { apiKey: 'owm-key', city: 'London', enabled: false }
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(savedData));

      const nm2 = new NotificationManager(dm);
      expect(nm2.apiKey).toBe('saved-api-key-123');
      expect(nm2.getProfiles().custom).toBeDefined();
      expect(nm2.weatherConfig.city).toBe('London');
    });

    test('handles corrupt file gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => { throw new Error('parse error'); });

      const nm2 = new NotificationManager(dm);
      // Should still have a valid API key (generated fallback)
      expect(nm2.apiKey).toBeDefined();
      expect(typeof nm2.apiKey).toBe('string');
    });

    test('starts with empty history', () => {
      expect(nm.getHistory()).toEqual([]);
    });
  });

  // ---- notify() ----

  describe('notify()', () => {
    test('sends notification to all online devices with notify capability', async () => {
      const entry = await nm.notify({
        title: 'Test Alert',
        message: 'Something happened',
        color: { r: 255, g: 0, b: 0 },
        pattern: 'flash',
        duration: 3000,
        priority: 2
      });

      expect(dm.sendCommand).toHaveBeenCalledTimes(2);
      expect(dm.sendCommand).toHaveBeenCalledWith('mirror', '/api/notify', {
        r: 255, g: 0, b: 0, pattern: 'flash', duration: 3000, priority: 2
      });
      expect(dm.sendCommand).toHaveBeenCalledWith('lamp', '/api/notify', {
        r: 255, g: 0, b: 0, pattern: 'flash', duration: 3000, priority: 2
      });
      expect(entry.title).toBe('Test Alert');
      expect(entry.results.mirror).toBe('ok');
      expect(entry.results.lamp).toBe('ok');
    });

    test('sends only to specified devices when provided', async () => {
      await nm.notify({
        title: 'Lamp Only',
        devices: ['lamp'],
        color: { r: 0, g: 255, b: 0 }
      });

      expect(dm.sendCommand).toHaveBeenCalledTimes(1);
      expect(dm.sendCommand).toHaveBeenCalledWith('lamp', '/api/notify', expect.any(Object));
    });

    test('skips devices without notify capability', async () => {
      const dmNoNotify = makeMockDm([
        { id: 'mirror', online: true, capabilities: ['color', 'notify'] },
        { id: 'lamp', online: true, capabilities: ['color'] }
      ]);
      const nm2 = new NotificationManager(dmNoNotify);

      await nm2.notify({ title: 'Test' });
      expect(dmNoNotify.sendCommand).toHaveBeenCalledTimes(1);
      expect(dmNoNotify.sendCommand).toHaveBeenCalledWith('mirror', '/api/notify', expect.any(Object));
    });

    test('skips offline devices', async () => {
      const dmOffline = makeMockDm([
        { id: 'mirror', online: true, capabilities: ['color', 'notify'] },
        { id: 'lamp', online: false, capabilities: ['color', 'notify'] }
      ]);
      const nm2 = new NotificationManager(dmOffline);

      await nm2.notify({ title: 'Online only' });
      expect(dmOffline.sendCommand).toHaveBeenCalledTimes(1);
      expect(dmOffline.sendCommand).toHaveBeenCalledWith('mirror', '/api/notify', expect.any(Object));
    });

    test('uses default values when config is minimal', async () => {
      const entry = await nm.notify({});
      expect(entry.title).toBe('Notification');
      expect(entry.pattern).toBe('flash');
      expect(entry.duration).toBe(3000);
      expect(entry.priority).toBe(2);
      expect(entry.color).toEqual({ r: 255, g: 255, b: 255 });
    });

    test('records notification in history', async () => {
      await nm.notify({ title: 'First' });
      await nm.notify({ title: 'Second' });

      const history = nm.getHistory();
      expect(history).toHaveLength(2);
      // Most recent first (unshift)
      expect(history[0].title).toBe('Second');
      expect(history[1].title).toBe('First');
    });

    test('history entries have timestamp', async () => {
      await nm.notify({ title: 'Timestamped' });
      const entry = nm.getHistory()[0];
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    });

    test('captures per-device errors in results', async () => {
      dm.sendCommand.mockImplementation((id) => {
        if (id === 'lamp') return Promise.reject(new Error('Device timeout'));
        return Promise.resolve({ ok: true });
      });

      const entry = await nm.notify({ title: 'Partial fail' });
      expect(entry.results.mirror).toBe('ok');
      expect(entry.results.lamp).toBe('Device timeout');
    });

    test('emits notificationSent event', async () => {
      const handler = jest.fn();
      nm.on('notificationSent', handler);

      await nm.notify({ title: 'Event test' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].title).toBe('Event test');
    });

    test('applies profile settings when profile name is given', async () => {
      // Note: setProfile uses `config.r || 255` so 0 becomes 255 (falsy).
      // Use non-zero values to verify profile merging works.
      nm.setProfile('urgent', {
        r: 255, g: 50, b: 10,
        pattern: 'strobe',
        duration: 5000,
        priority: 3
      });

      await nm.notify({ title: 'Urgent!', profile: 'urgent' });

      expect(dm.sendCommand).toHaveBeenCalledWith('mirror', '/api/notify', {
        r: 255, g: 50, b: 10,
        pattern: 'strobe',
        duration: 5000,
        priority: 3
      });
    });

    test('ignores unknown profile name and uses provided values', async () => {
      await nm.notify({
        title: 'No profile',
        profile: 'nonexistent',
        color: { r: 10, g: 20, b: 30 },
        pattern: 'pulse'
      });

      expect(dm.sendCommand).toHaveBeenCalledWith('mirror', '/api/notify', expect.objectContaining({
        r: 10, g: 20, b: 30,
        pattern: 'pulse'
      }));
    });
  });

  // ---- Profiles ----

  describe('profiles', () => {
    test('setProfile creates a new profile', () => {
      nm.setProfile('warning', { r: 255, g: 200, b: 0, pattern: 'pulse' });
      const profiles = nm.getProfiles();
      expect(profiles.warning).toBeDefined();
      expect(profiles.warning.r).toBe(255);
      expect(profiles.warning.pattern).toBe('pulse');
    });

    test('setProfile applies defaults for missing fields', () => {
      nm.setProfile('minimal', {});
      const p = nm.getProfiles().minimal;
      expect(p.r).toBe(255);
      expect(p.g).toBe(255);
      expect(p.b).toBe(255);
      expect(p.pattern).toBe('flash');
      expect(p.duration).toBe(3000);
      expect(p.priority).toBe(2);
    });

    test('setProfile persists to file', () => {
      fs.writeFileSync.mockClear();
      nm.setProfile('saved', { r: 1, g: 2, b: 3 });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('setProfile emits profilesUpdated event', () => {
      const handler = jest.fn();
      nm.on('profilesUpdated', handler);
      nm.setProfile('event', { r: 0, g: 0, b: 0 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('removeProfile deletes existing profile', () => {
      nm.setProfile('temp', { r: 0, g: 0, b: 0 });
      expect(nm.removeProfile('temp')).toBe(true);
      expect(nm.getProfiles().temp).toBeUndefined();
    });

    test('removeProfile returns false for non-existent profile', () => {
      expect(nm.removeProfile('nope')).toBe(false);
    });

    test('getProfiles returns all profiles', () => {
      // Default profiles are seeded on first run
      const profiles = nm.getProfiles();
      expect(Object.keys(profiles).length).toBeGreaterThanOrEqual(3);
    });
  });

  // ---- API Key ----

  describe('API key', () => {
    test('validateApiKey returns true for correct key', () => {
      const key = nm.apiKey;
      expect(nm.validateApiKey(key)).toBe(true);
    });

    test('validateApiKey returns false for wrong key', () => {
      expect(nm.validateApiKey('wrong-key')).toBe(false);
    });

    test('validateApiKey returns false for empty string', () => {
      expect(nm.validateApiKey('')).toBe(false);
    });

    test('regenerateApiKey changes the key', () => {
      const oldKey = nm.apiKey;
      // Return a different buffer for new key
      crypto.randomBytes.mockReturnValueOnce(Buffer.from('ff'.repeat(16), 'hex'));
      const newKey = nm.regenerateApiKey();
      expect(newKey).not.toBe(oldKey);
      expect(nm.validateApiKey(newKey)).toBe(true);
      expect(nm.validateApiKey(oldKey)).toBe(false);
    });

    test('regenerateApiKey persists to file', () => {
      fs.writeFileSync.mockClear();
      nm.regenerateApiKey();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ---- History ----

  describe('history', () => {
    test('getHistory returns empty array initially', () => {
      expect(nm.getHistory()).toEqual([]);
    });

    test('getHistory respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await nm.notify({ title: `Notification ${i}` });
      }
      const limited = nm.getHistory(3);
      expect(limited).toHaveLength(3);
    });

    test('getHistory defaults to 20 entries', async () => {
      // Send 25 notifications
      for (let i = 0; i < 25; i++) {
        await nm.notify({ title: `N${i}` });
      }
      const history = nm.getHistory();
      expect(history).toHaveLength(20);
    });

    test('history is capped at MAX_HISTORY (50)', async () => {
      for (let i = 0; i < 55; i++) {
        await nm.notify({ title: `N${i}` });
      }
      // Internal history capped at 50
      expect(nm.history.length).toBe(50);
    });

    test('clearHistory empties the list', async () => {
      await nm.notify({ title: 'To clear' });
      nm.clearHistory();
      expect(nm.getHistory()).toEqual([]);
    });

    test('clearHistory emits historyCleared event', () => {
      const handler = jest.fn();
      nm.on('historyCleared', handler);
      nm.clearHistory();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Weather ----

  describe('weather', () => {
    test('weatherConfig defaults to disabled', () => {
      expect(nm.weatherConfig.enabled).toBe(false);
      expect(nm.weatherConfig.apiKey).toBe('');
      expect(nm.weatherConfig.city).toBe('');
    });

    test('setWeatherConfig updates city and apiKey', () => {
      nm.setWeatherConfig({ apiKey: 'test-key', city: 'London' });
      expect(nm.weatherConfig.apiKey).toBe('test-key');
      expect(nm.weatherConfig.city).toBe('London');
    });

    test('startWeather returns false without apiKey', () => {
      expect(nm.startWeather()).toBe(false);
    });

    test('startWeather returns false without city', () => {
      nm.weatherConfig.apiKey = 'some-key';
      expect(nm.startWeather()).toBe(false);
    });

    test('stopWeather sets enabled to false and clears timer', () => {
      nm.weatherConfig.enabled = true;
      nm.weatherTimer = setInterval(() => {}, 999999);
      nm.stopWeather();
      expect(nm.weatherConfig.enabled).toBe(false);
      expect(nm.weatherTimer).toBeNull();
    });

    test('weatherNotify returns null when no weather data', async () => {
      const result = await nm.weatherNotify();
      expect(result).toBeNull();
    });

    test('weatherNotify sends notification when weather data exists', async () => {
      nm.weatherData = {
        temp: 15,
        condition: 'Clear',
        description: 'clear sky',
        city: 'London'
      };
      const entry = await nm.weatherNotify();
      expect(entry).not.toBeNull();
      expect(entry.title).toContain('Weather');
      expect(dm.sendCommand).toHaveBeenCalled();
    });
  });

  // ---- Status ----

  describe('getStatus()', () => {
    test('returns complete status object', () => {
      const status = nm.getStatus();
      expect(status).toHaveProperty('apiKey');
      expect(status).toHaveProperty('profiles');
      expect(status).toHaveProperty('historyCount');
      expect(status).toHaveProperty('weather');
      expect(status.weather).toHaveProperty('enabled');
      expect(status.weather).toHaveProperty('city');
      expect(status.weather).toHaveProperty('hasApiKey');
    });

    test('historyCount reflects actual history length', async () => {
      await nm.notify({ title: 'A' });
      await nm.notify({ title: 'B' });
      expect(nm.getStatus().historyCount).toBe(2);
    });
  });

  // ---- Shutdown ----

  describe('stop()', () => {
    test('clears weather timer', () => {
      nm.weatherTimer = setInterval(() => {}, 999999);
      nm.stop();
      expect(nm.weatherTimer).toBeNull();
    });

    test('handles stop when no timer is set', () => {
      expect(() => nm.stop()).not.toThrow();
    });
  });
});
