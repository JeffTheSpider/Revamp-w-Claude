// ============================================================
// Group Manager
// ============================================================
// Manages named device groups for batch operations.
// Persists to groups.json. Groups can overlap (a device can
// be in multiple groups).
// ============================================================

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'groups.json');

class GroupManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.dm = deviceManager;
    this.groups = {};
    this._load();
  }

  // Create or update a group
  set(name, deviceIds, description = '') {
    if (!name || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      throw new Error('Group needs a name and at least one device');
    }
    // Validate device IDs exist
    for (const id of deviceIds) {
      if (!this.dm.get(id)) {
        throw new Error(`Unknown device: ${id}`);
      }
    }
    this.groups[name] = {
      name,
      devices: deviceIds,
      description,
      createdAt: this.groups[name]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this._save();
    this.emit('groupSaved', name);
    return this.groups[name];
  }

  // Delete a group
  delete(name) {
    if (!this.groups[name]) return false;
    delete this.groups[name];
    this._save();
    this.emit('groupDeleted', name);
    return true;
  }

  // Get a single group
  get(name) {
    return this.groups[name] || null;
  }

  // List all groups with online status
  list() {
    return Object.values(this.groups).map(g => ({
      name: g.name,
      description: g.description,
      devices: g.devices,
      onlineCount: g.devices.filter(id => {
        const d = this.dm.get(id);
        return d && d.online;
      }).length,
      createdAt: g.createdAt
    }));
  }

  // Get online device IDs for a group
  getOnlineDevices(name) {
    const group = this.groups[name];
    if (!group) throw new Error(`Group "${name}" not found`);
    return group.devices.filter(id => {
      const d = this.dm.get(id);
      return d && d.online;
    });
  }

  // Execute a command on all devices in a group
  async executeOnGroup(name, endpoint, params = {}) {
    const ids = this.getOnlineDevices(name);
    const results = {};
    for (const id of ids) {
      try {
        await this.dm.sendCommand(id, endpoint, params);
        results[id] = 'ok';
      } catch (e) {
        results[id] = e.message;
      }
    }
    return results;
  }

  _save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.groups, null, 2));
    } catch (e) {
      console.error('[GroupManager] Save failed:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        this.groups = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        console.log(`[GroupManager] Loaded ${Object.keys(this.groups).length} groups`);
      }
    } catch (e) {
      console.error('[GroupManager] Load failed:', e.message);
      this.groups = {};
    }
  }
}

module.exports = GroupManager;
