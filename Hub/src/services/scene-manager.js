// ============================================================
// Scene Manager
// ============================================================
// Saves and loads device state snapshots. Scenes are persisted
// to scenes.json. Supports scheduled activation via node-cron.
// ============================================================

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const cron = require('node-cron');

const SCENES_FILE = path.join(__dirname, '..', '..', 'scenes.json');

class SceneManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.dm = deviceManager;
    this.scenes = {};
    this.schedules = {};  // { sceneName: { cron, enabled, description } }
    this.cronJobs = {};   // Active cron job instances
    this.load();
    this.startSchedules();
  }

  // Load scenes from disk
  load() {
    try {
      if (fs.existsSync(SCENES_FILE)) {
        const data = JSON.parse(fs.readFileSync(SCENES_FILE, 'utf8'));
        this.scenes = data.scenes || {};
        this.schedules = data.schedules || {};
        console.log(`[SceneManager] Loaded ${Object.keys(this.scenes).length} scenes`);
      }
    } catch (err) {
      console.error('[SceneManager] Failed to load scenes:', err.message);
      this.scenes = {};
      this.schedules = {};
    }
  }

  // Save scenes to disk
  save() {
    try {
      const data = { scenes: this.scenes, schedules: this.schedules };
      fs.writeFileSync(SCENES_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[SceneManager] Failed to save:', err.message);
    }
  }

  // List all scenes (includes schedule info if any)
  list() {
    return Object.entries(this.scenes).map(([name, scene]) => ({
      name,
      description: scene.description || '',
      deviceCount: Object.keys(scene.devices).length,
      createdAt: scene.createdAt,
      schedule: this.schedules[name] || null
    }));
  }

  // Get a single scene by name
  get(name) {
    return this.scenes[name] || null;
  }

  // Save current state of all online devices as a named scene
  // Polls fresh status from each device to avoid stale cache
  async capture(name, description = '') {
    const devices = this.dm.getAll();
    const deviceStates = {};

    for (const dev of devices) {
      if (dev.online) {
        try {
          // Fetch live status (not cached) for accurate capture
          const freshStatus = await this.dm.sendCommand(dev.id, '/api/status');
          deviceStates[dev.id] = {
            mode: freshStatus.mode,
            brightness: freshStatus.brightness,
            color: freshStatus.color || null
          };
        } catch (_) {
          // Fallback to cached status if live poll fails
          if (dev.status) {
            deviceStates[dev.id] = {
              mode: dev.status.mode,
              brightness: dev.status.brightness,
              color: dev.status.color || null
            };
          }
        }
      }
    }

    if (Object.keys(deviceStates).length === 0) {
      throw new Error('No online devices to capture');
    }

    this.scenes[name] = {
      description,
      devices: deviceStates,
      createdAt: new Date().toISOString()
    };

    this.save();
    this.emit('sceneSaved', name);
    return this.scenes[name];
  }

  // Activate a saved scene (apply to all devices)
  async activate(name) {
    const scene = this.scenes[name];
    if (!scene) throw new Error(`Scene "${name}" not found`);

    const results = {};

    for (const [deviceId, state] of Object.entries(scene.devices)) {
      const device = this.dm.get(deviceId);
      if (!device || !device.online) {
        results[deviceId] = 'offline';
        continue;
      }

      try {
        // Set pattern (with color params if custom color mode)
        const params = { id: state.mode };
        if (state.mode === 'color' && state.color) {
          params.r = state.color.r;
          params.g = state.color.g;
          params.b = state.color.b;
        }
        await this.dm.sendCommand(deviceId, '/api/pattern', params);

        // Set brightness
        if (state.brightness) {
          await this.dm.sendCommand(deviceId, '/api/brightness', { val: state.brightness });
        }

        results[deviceId] = 'ok';
      } catch (err) {
        results[deviceId] = err.message;
      }
    }

    this.emit('sceneActivated', name, results);
    return results;
  }

  // Delete a scene
  delete(name) {
    if (!this.scenes[name]) return false;
    delete this.scenes[name];
    delete this.schedules[name]; // Remove any associated schedule
    this.save();
    this.emit('sceneDeleted', name);
    return true;
  }

  // Create a scene from explicit device states (not from current state)
  create(name, description, deviceStates) {
    this.scenes[name] = {
      description,
      devices: deviceStates,
      createdAt: new Date().toISOString()
    };
    this.save();
    this.emit('sceneSaved', name);
    return this.scenes[name];
  }

  // ---- Scheduling ----

  // Start all enabled schedules from persisted config
  startSchedules() {
    for (const [sceneName, sched] of Object.entries(this.schedules)) {
      if (sched.enabled && this.scenes[sceneName]) {
        this.startCronJob(sceneName, sched.cron);
      }
    }
    const active = Object.values(this.schedules).filter(s => s.enabled).length;
    if (active > 0) {
      console.log(`[SceneManager] Started ${active} scheduled scene(s)`);
    }
  }

  // Start a cron job for a scene
  startCronJob(sceneName, cronExpr) {
    // Stop existing job if any
    this.stopCronJob(sceneName);

    if (!cron.validate(cronExpr)) {
      console.error(`[SceneManager] Invalid cron: "${cronExpr}" for scene "${sceneName}"`);
      return false;
    }

    this.cronJobs[sceneName] = cron.schedule(cronExpr, () => {
      console.log(`[SceneManager] Scheduled activation: "${sceneName}"`);
      this.activate(sceneName).then(results => {
        this.emit('scheduledActivation', sceneName, results);
      }).catch(err => {
        console.error(`[SceneManager] Scheduled activation failed: ${err.message}`);
      });
    });

    return true;
  }

  // Stop a cron job
  stopCronJob(sceneName) {
    if (this.cronJobs[sceneName]) {
      this.cronJobs[sceneName].stop();
      delete this.cronJobs[sceneName];
    }
  }

  // Set a schedule for a scene
  setSchedule(sceneName, cronExpr, description = '') {
    if (!this.scenes[sceneName]) {
      throw new Error(`Scene "${sceneName}" not found`);
    }
    if (!cron.validate(cronExpr)) {
      throw new Error(`Invalid cron expression: "${cronExpr}"`);
    }

    this.schedules[sceneName] = {
      cron: cronExpr,
      enabled: true,
      description,
      createdAt: new Date().toISOString()
    };

    this.startCronJob(sceneName, cronExpr);
    this.save();
    this.emit('scheduleSet', sceneName, this.schedules[sceneName]);
    return this.schedules[sceneName];
  }

  // Enable/disable a schedule without removing it
  toggleSchedule(sceneName, enabled) {
    if (!this.schedules[sceneName]) {
      throw new Error(`No schedule for scene "${sceneName}"`);
    }

    this.schedules[sceneName].enabled = enabled;

    if (enabled) {
      this.startCronJob(sceneName, this.schedules[sceneName].cron);
    } else {
      this.stopCronJob(sceneName);
    }

    this.save();
    this.emit('scheduleToggled', sceneName, enabled);
    return this.schedules[sceneName];
  }

  // Remove a schedule
  removeSchedule(sceneName) {
    if (!this.schedules[sceneName]) return false;
    this.stopCronJob(sceneName);
    delete this.schedules[sceneName];
    this.save();
    this.emit('scheduleRemoved', sceneName);
    return true;
  }

  // List all schedules
  listSchedules() {
    return Object.entries(this.schedules).map(([sceneName, sched]) => ({
      scene: sceneName,
      cron: sched.cron,
      enabled: sched.enabled,
      description: sched.description || '',
      running: !!this.cronJobs[sceneName]
    }));
  }

  // Stop all cron jobs (for cleanup on shutdown)
  stopAll() {
    for (const name of Object.keys(this.cronJobs)) {
      this.stopCronJob(name);
    }
  }
}

module.exports = SceneManager;
