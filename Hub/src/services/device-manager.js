// ============================================================
// Device Manager
// ============================================================
// Discovers and polls ESP devices. Emits events on status
// changes, online/offline transitions.
// ============================================================

const EventEmitter = require('events');
const http = require('http');

// Known devices (static fallback if mDNS unavailable)
const KNOWN_DEVICES = [
  { id: 'mirror', name: "Charlie's Mirror", hostname: 'mirror.local', ip: '192.168.0.201' },
  { id: 'lamp',   name: "Charlie's Lamp",   hostname: 'lamp.local',   ip: '192.168.0.202' }
];

const POLL_INTERVAL = 10000; // 10s health check
const REQUEST_TIMEOUT = 5000; // 5s HTTP timeout

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.pollTimer = null;

    // Initialize known devices
    for (const dev of KNOWN_DEVICES) {
      this.devices.set(dev.id, {
        ...dev,
        online: false,
        lastSeen: null,
        status: null
      });
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

  // Poll all devices for status
  async pollAll() {
    for (const [id] of this.devices) {
      this.pollDevice(id);
    }
  }

  // Poll a single device
  pollDevice(id) {
    const device = this.devices.get(id);
    if (!device) return;

    const url = `http://${device.ip}/api/status`;
    this.httpGet(url)
      .then((data) => {
        const wasOffline = !device.online;
        device.online = true;
        device.lastSeen = new Date().toISOString();
        device.status = data;
        this.devices.set(id, device);

        if (wasOffline) {
          this.emit('deviceOnline', id);
        }
        this.emit('statusUpdate', id, device);
      })
      .catch(() => {
        if (device.online) {
          device.online = false;
          this.devices.set(id, device);
          this.emit('deviceOffline', id);
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
  async sendColor(deviceId, r, g, b) {
    return this.sendCommand(deviceId, '/api/pattern', { id: 'color', r, g, b });
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
