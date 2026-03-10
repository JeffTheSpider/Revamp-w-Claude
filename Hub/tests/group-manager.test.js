// ============================================================
// GroupManager Unit Tests
// ============================================================
// Tests the GroupManager service: group CRUD, persistence,
// device validation, online filtering, and batch execution.
// ============================================================

const fs = require('fs');

// Mock fs before requiring GroupManager
jest.mock('fs');

// Provide a real path.join (not mocked)
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'groups.json');

let GroupManager;

beforeAll(() => {
  // Default fs mock behavior: no file exists
  fs.existsSync.mockReturnValue(false);
  fs.readFileSync.mockReturnValue('{}');
  fs.writeFileSync.mockImplementation(() => {});
  GroupManager = require('../src/services/group-manager');
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---- Mock DeviceManager Factory ----

function makeMockDm(devices = {}) {
  return {
    get: jest.fn((id) => devices[id] || null),
    getAll: jest.fn(() => Object.values(devices)),
    sendCommand: jest.fn(() => Promise.resolve({ ok: true }))
  };
}

// ---- Tests ----

describe('GroupManager', () => {
  let dm;
  let gm;

  beforeEach(() => {
    dm = makeMockDm({
      mirror: { id: 'mirror', ip: '192.168.0.201', online: true },
      lamp: { id: 'lamp', ip: '192.168.0.202', online: true }
    });

    // No existing file on disk
    fs.existsSync.mockReturnValue(false);
    gm = new GroupManager(dm);
  });

  // ---- Constructor & Loading ----

  describe('constructor', () => {
    test('starts with empty groups when no file exists', () => {
      expect(gm.list()).toEqual([]);
    });

    test('is an EventEmitter', () => {
      const EventEmitter = require('events');
      expect(gm).toBeInstanceOf(EventEmitter);
    });

    test('loads existing groups from file', () => {
      const existing = {
        all: {
          name: 'all',
          devices: ['mirror', 'lamp'],
          description: 'All devices',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(existing));

      const gm2 = new GroupManager(dm);
      expect(gm2.get('all')).not.toBeNull();
      expect(gm2.get('all').devices).toEqual(['mirror', 'lamp']);
    });

    test('handles corrupt file gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{ broken json!!!');

      const gm2 = new GroupManager(dm);
      expect(gm2.list()).toEqual([]);
    });
  });

  // ---- set() ----

  describe('set()', () => {
    test('creates a new group with correct fields', () => {
      const result = gm.set('bedroom', ['lamp'], 'Bedroom devices');
      expect(result.name).toBe('bedroom');
      expect(result.devices).toEqual(['lamp']);
      expect(result.description).toBe('Bedroom devices');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    test('preserves createdAt when updating', () => {
      const first = gm.set('mygroup', ['mirror'], 'v1');
      const createdAt = first.createdAt;

      const updated = gm.set('mygroup', ['mirror', 'lamp'], 'v2');
      expect(updated.createdAt).toBe(createdAt);
      expect(updated.devices).toEqual(['mirror', 'lamp']);
      expect(updated.description).toBe('v2');
    });

    test('defaults description to empty string', () => {
      const result = gm.set('nodesc', ['mirror']);
      expect(result.description).toBe('');
    });

    test('throws when name is empty', () => {
      expect(() => gm.set('', ['mirror'])).toThrow('Group needs a name');
    });

    test('throws when name is null', () => {
      expect(() => gm.set(null, ['mirror'])).toThrow();
    });

    test('throws when deviceIds is not an array', () => {
      expect(() => gm.set('test', 'mirror')).toThrow('Group needs a name and at least one device');
    });

    test('throws when deviceIds is empty array', () => {
      expect(() => gm.set('test', [])).toThrow('Group needs a name and at least one device');
    });

    test('throws for unknown device ID', () => {
      expect(() => gm.set('test', ['nonexistent'])).toThrow('Unknown device: nonexistent');
    });

    test('validates all device IDs', () => {
      expect(() => gm.set('test', ['mirror', 'ghost'])).toThrow('Unknown device: ghost');
      expect(dm.get).toHaveBeenCalledWith('mirror');
      expect(dm.get).toHaveBeenCalledWith('ghost');
    });

    test('persists to file on set', () => {
      gm.set('persisted', ['lamp']);
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = fs.writeFileSync.mock.calls[0];
      const written = JSON.parse(writeCall[1]);
      expect(written.persisted).toBeDefined();
      expect(written.persisted.devices).toEqual(['lamp']);
    });

    test('emits groupSaved event', () => {
      const handler = jest.fn();
      gm.on('groupSaved', handler);
      gm.set('test', ['mirror']);
      expect(handler).toHaveBeenCalledWith('test');
    });
  });

  // ---- delete() ----

  describe('delete()', () => {
    test('deletes an existing group and returns true', () => {
      gm.set('todelete', ['mirror']);
      expect(gm.delete('todelete')).toBe(true);
      expect(gm.get('todelete')).toBeNull();
    });

    test('returns false for non-existent group', () => {
      expect(gm.delete('nope')).toBe(false);
    });

    test('persists deletion to file', () => {
      gm.set('temp', ['mirror']);
      fs.writeFileSync.mockClear();
      gm.delete('temp');
      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(written.temp).toBeUndefined();
    });

    test('emits groupDeleted event', () => {
      const handler = jest.fn();
      gm.on('groupDeleted', handler);
      gm.set('evt', ['mirror']);
      gm.delete('evt');
      expect(handler).toHaveBeenCalledWith('evt');
    });

    test('does not emit event for non-existent group', () => {
      const handler = jest.fn();
      gm.on('groupDeleted', handler);
      gm.delete('nope');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ---- get() ----

  describe('get()', () => {
    test('returns group by name', () => {
      gm.set('mygroup', ['mirror', 'lamp']);
      const group = gm.get('mygroup');
      expect(group.name).toBe('mygroup');
      expect(group.devices).toEqual(['mirror', 'lamp']);
    });

    test('returns null for unknown name', () => {
      expect(gm.get('unknown')).toBeNull();
    });
  });

  // ---- list() ----

  describe('list()', () => {
    test('returns array of group summaries', () => {
      gm.set('a', ['mirror'], 'Group A');
      gm.set('b', ['lamp'], 'Group B');
      const list = gm.list();
      expect(list).toHaveLength(2);
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('description');
      expect(list[0]).toHaveProperty('devices');
      expect(list[0]).toHaveProperty('onlineCount');
      expect(list[0]).toHaveProperty('createdAt');
    });

    test('counts online devices correctly', () => {
      gm.set('both', ['mirror', 'lamp']);
      const list = gm.list();
      const group = list.find(g => g.name === 'both');
      expect(group.onlineCount).toBe(2);
    });

    test('reports zero online when devices are offline', () => {
      const offlineDm = makeMockDm({
        mirror: { id: 'mirror', online: false },
        lamp: { id: 'lamp', online: false }
      });
      const gm2 = new GroupManager(offlineDm);
      gm2.groups = {
        offline: { name: 'offline', devices: ['mirror', 'lamp'], description: '', createdAt: '', updatedAt: '' }
      };
      const list = gm2.list();
      expect(list[0].onlineCount).toBe(0);
    });
  });

  // ---- getOnlineDevices() ----

  describe('getOnlineDevices()', () => {
    test('returns only online device IDs', () => {
      const mixedDm = makeMockDm({
        mirror: { id: 'mirror', online: true },
        lamp: { id: 'lamp', online: false }
      });
      const gm2 = new GroupManager(mixedDm);
      gm2.groups = {
        mixed: { name: 'mixed', devices: ['mirror', 'lamp'], description: '', createdAt: '', updatedAt: '' }
      };
      const online = gm2.getOnlineDevices('mixed');
      expect(online).toEqual(['mirror']);
    });

    test('throws for unknown group', () => {
      expect(() => gm.getOnlineDevices('nope')).toThrow('Group "nope" not found');
    });
  });

  // ---- executeOnGroup() ----

  describe('executeOnGroup()', () => {
    test('sends command to all online devices in group', async () => {
      gm.set('all', ['mirror', 'lamp']);
      const results = await gm.executeOnGroup('all', '/api/pattern', { id: 'rainbow' });
      expect(dm.sendCommand).toHaveBeenCalledTimes(2);
      expect(dm.sendCommand).toHaveBeenCalledWith('mirror', '/api/pattern', { id: 'rainbow' });
      expect(dm.sendCommand).toHaveBeenCalledWith('lamp', '/api/pattern', { id: 'rainbow' });
      expect(results.mirror).toBe('ok');
      expect(results.lamp).toBe('ok');
    });

    test('captures per-device errors without throwing', async () => {
      dm.sendCommand.mockImplementation((id) => {
        if (id === 'lamp') return Promise.reject(new Error('Timeout'));
        return Promise.resolve();
      });
      gm.set('all', ['mirror', 'lamp']);
      const results = await gm.executeOnGroup('all', '/api/brightness', { dir: 'up' });
      expect(results.mirror).toBe('ok');
      expect(results.lamp).toBe('Timeout');
    });

    test('skips offline devices', async () => {
      const mixedDm = makeMockDm({
        mirror: { id: 'mirror', online: true },
        lamp: { id: 'lamp', online: false }
      });
      const gm2 = new GroupManager(mixedDm);
      gm2.groups = {
        mixed: { name: 'mixed', devices: ['mirror', 'lamp'], description: '', createdAt: '', updatedAt: '' }
      };
      const results = await gm2.executeOnGroup('mixed', '/api/pattern', { id: 'candle' });
      expect(mixedDm.sendCommand).toHaveBeenCalledTimes(1);
      expect(results).toEqual({ mirror: 'ok' });
    });

    test('throws for unknown group', async () => {
      await expect(gm.executeOnGroup('nope', '/api/pattern', {}))
        .rejects.toThrow('Group "nope" not found');
    });
  });
});
