// ============================================================
// Device Manager
// ============================================================
// Discovers and polls ESP devices. Emits events on status
// changes, online/offline transitions.
// ============================================================

const EventEmitter = require('events');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Load config (device list, polling settings)
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
let config = { devices: [], polling: {} };
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error('[DeviceManager] Failed to load config.json, using defaults');
}

const KNOWN_DEVICES = config.devices || [];
const POLL_INTERVAL = (config.polling && config.polling.interval) || 10000;
const REQUEST_TIMEOUT = (config.polling && config.polling.timeout) || 5000;
const MAX_BACKOFF = (config.polling && config.polling.maxBackoff) || 60000;

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.pollTimer = null;
    this.failCounts = new Map(); // deviceId -> consecutive failure count
    this._pollCounter = 0;       // Backoff cycle counter

    // Initialize known devices
    for (const dev of KNOWN_DEVICES) {
      this.devices.set(dev.id, {
        ...dev,
        online: false,
        lastSeen: null,
        status: null,
        capabilities: null // Populated on first successful poll
      });
      this.failCounts.set(dev.id, 0);
    }
  }

  // Start polling loop
  start() {
    console.log(`[DeviceManager] Starting (polling every ${POLL_INTERVAL / 1000}s)`);
    this.pollAll();
    this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  // Get all devices as array
  getAll() {
    return Array.from(this.devices.values());
  }

  // Get single device by ID
  get(id) {
    return this.devices.get(id) || null;
  }

  // Poll all devices for status (with backoff for offline devices)
  async pollAll() {
    const now = Date.now();
    for (const [id] of this.devices) {
      const fails = this.failCounts.get(id) || 0;
      // Exponential backoff: skip polls for offline devices based on failure count
      // After 1 fail: poll every 2nd cycle, after 2: every 4th, etc.
      if (fails > 0) {
        const backoffCycles = Math.min(Math.pow(2, fails - 1), MAX_BACKOFF / POLL_INTERVAL);
        if (this._pollCounter % Math.ceil(backoffCycles) !== 0) continue;
      }
      this.pollDevice(id);
    }
    this._pollCounter++;
  }

  // Poll a single device
  pollDevice(id) {
    const device = this.devices.get(id);
    if (!device) return;

    const url = `http://${device.ip}/api/status`;
    this.httpGet(url)
      .then((data) => {
        const wasOffline = !device.online;
        this.failCounts.set(id, 0); // Reset failure counter
        device.online = true;
        device.lastSeen = new Date().toISOString();
        device.status = data;

        // Use explicit capabilities from firmware, fallback to detection
        if (data.capabilities) {
          device.capabilities = data.capabilities;
        } else if (!device.capabilities) {
          device.capabilities = {
            morse: !!(data.strips || data.ledCount),
            color: true,
            ntp: data.ntpValid !== undefined,
            oled: !!data.oled
          };
        }

        this.devices.set(id, device);

        if (wasOffline) {
          this.emit('deviceOnline', id);
        }
        this.emit('statusUpdate', id, device);
      })
      .catch((err) => {
        const fails = (this.failCounts.get(id) || 0) + 1;
        this.failCounts.set(id, Math.min(fails, 6)); // Cap at 6 (64x backoff)
        if (device.online) {
          device.online = false;
          this.devices.set(id, device);
          // Include error type for diagnostics
          const reason = err.code === 'ECONNREFUSED' ? 'refused'
            : err.message === 'Timeout' ? 'timeout' : 'error';
          this.emit('deviceOffline', id, reason);
        }
      });
  }

  // Send a command to a device
  async sendCommand(deviceId, endpoint, params = {}) {
    const device = this.devices.get(deviceId);
    if (!device || !device.online) {
      throw new Error(`Device ${deviceId} not available`);
    }

    const query = new URLSearchParams(params).toString();
    const url = `http://${device.ip}${endpoint}${query ? '?' + query : ''}`;
    return this.httpGet(url);
  }

  // Send color to a device (for real-time color picker)
  // Uses /api/color endpoint which sets custom RGB and switches to color mode
  async sendColor(deviceId, r, g, b) {
    return this.sendCommand(deviceId, '/api/color', { r, g, b });
  }

  // Simple HTTP GET with timeout, returns parsed JSON or text
  httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: REQUEST_TIMEOUT }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = DeviceManager;
