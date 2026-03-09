// ============================================================
// Notification Manager
// ============================================================
// Sends LED notification overlays to devices via /api/notify.
// External webhook support for IFTTT, Tasker, curl, etc.
// Named profiles for per-app notification styles.
// Weather integration via OpenWeatherMap (optional).
// ============================================================

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', '..', 'notifications.json');
const MAX_HISTORY = 50;

class NotificationManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.dm = deviceManager;
    this.history = [];
    this.profiles = {};
    this.apiKey = '';
    this.weatherConfig = { apiKey: '', city: '', enabled: false };
    this.weatherData = null;
    this.weatherTimer = null;
    this._load();
  }

  // ---- Core: Send notification to devices ----

  async notify(config) {
    const {
      title = 'Notification',
      message = '',
      color = { r: 255, g: 255, b: 255 },
      pattern = 'flash',
      duration = 3000,
      priority = 2,
      devices = [],
      profile = null
    } = config;

    // If a profile name is specified, merge its settings
    let finalColor = color;
    let finalPattern = pattern;
    let finalDuration = duration;
    let finalPriority = priority;

    if (profile && this.profiles[profile]) {
      const p = this.profiles[profile];
      finalColor = { r: p.r, g: p.g, b: p.b };
      finalPattern = p.pattern || pattern;
      finalDuration = p.duration || duration;
      finalPriority = p.priority || priority;
    }

    // Determine target devices
    const allDevices = this.dm.getAll();
    let targets;
    if (devices.length > 0) {
      targets = devices;
    } else {
      // Send to all online devices with notify capability
      // getAll() returns an array of device objects (not a map)
      targets = allDevices
        .filter(dev => dev.online && dev.capabilities && dev.capabilities.includes('notify'))
        .map(dev => dev.id);
    }

    // Send to each target device
    const results = {};
    for (const id of targets) {
      try {
        await this.dm.sendCommand(id, '/api/notify', {
          r: finalColor.r,
          g: finalColor.g,
          b: finalColor.b,
          pattern: finalPattern,
          duration: finalDuration,
          priority: finalPriority
        });
        results[id] = 'ok';
      } catch (e) {
        results[id] = e.message;
      }
    }

    // Add to history
    const entry = {
      timestamp: new Date().toISOString(),
      title,
      message,
      color: finalColor,
      pattern: finalPattern,
      duration: finalDuration,
      priority: finalPriority,
      devices: targets,
      results
    };
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) this.history.pop();

    console.log(`[Notify] "${title}" → ${targets.join(', ')} (${finalPattern}, ${finalDuration}ms)`);
    this.emit('notificationSent', entry);
    return entry;
  }

  // ---- Profiles ----

  setProfile(name, config) {
    this.profiles[name] = {
      r: config.r || 255,
      g: config.g || 255,
      b: config.b || 255,
      pattern: config.pattern || 'flash',
      duration: config.duration || 3000,
      priority: config.priority || 2
    };
    this._save();
    this.emit('profilesUpdated', this.profiles);
  }

  removeProfile(name) {
    if (this.profiles[name]) {
      delete this.profiles[name];
      this._save();
      this.emit('profilesUpdated', this.profiles);
      return true;
    }
    return false;
  }

  getProfiles() { return this.profiles; }

  // ---- API Key ----

  validateApiKey(key) {
    return key === this.apiKey;
  }

  regenerateApiKey() {
    this.apiKey = this._generateKey();
    this._save();
    return this.apiKey;
  }

  // ---- History ----

  getHistory(limit = 20) {
    return this.history.slice(0, limit);
  }

  clearHistory() {
    this.history = [];
    this.emit('historyCleared');
  }

  // ---- Weather Integration ----

  startWeather() {
    if (!this.weatherConfig.apiKey || !this.weatherConfig.city) {
      console.log('[Notify] Weather not configured (missing API key or city)');
      return false;
    }
    if (this.weatherTimer) clearInterval(this.weatherTimer);
    this.weatherConfig.enabled = true;
    this._save();
    this._fetchWeather(); // Fetch immediately
    this.weatherTimer = setInterval(() => this._fetchWeather(), 15 * 60 * 1000); // 15 min
    console.log(`[Notify] Weather started for ${this.weatherConfig.city}`);
    return true;
  }

  stopWeather() {
    this.weatherConfig.enabled = false;
    if (this.weatherTimer) { clearInterval(this.weatherTimer); this.weatherTimer = null; }
    this._save();
    console.log('[Notify] Weather stopped');
  }

  setWeatherConfig(config) {
    if (config.apiKey !== undefined) this.weatherConfig.apiKey = config.apiKey;
    if (config.city !== undefined) this.weatherConfig.city = config.city;
    this._save();
    // Restart if already running
    if (this.weatherConfig.enabled) this.startWeather();
  }

  _fetchWeather() {
    const { apiKey, city } = this.weatherConfig;
    if (!apiKey || !city) return;

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.cod === 200) {
            this.weatherData = {
              temp: Math.round(data.main.temp),
              condition: data.weather[0].main,
              description: data.weather[0].description,
              icon: data.weather[0].icon,
              humidity: data.main.humidity,
              wind: data.wind.speed,
              city: data.name,
              updatedAt: new Date().toISOString()
            };
            this.emit('weatherUpdate', this.weatherData);
          } else {
            console.error(`[Notify] Weather API error: ${data.message || data.cod}`);
          }
        } catch (e) {
          console.error('[Notify] Weather parse error:', e.message);
        }
      });
    }).on('error', (e) => {
      console.error('[Notify] Weather fetch error:', e.message);
    });
  }

  // Map weather condition to a notification
  async weatherNotify() {
    if (!this.weatherData) return null;

    const condMap = {
      'Clear': { r: 255, g: 200, b: 50, pattern: 'pulse', label: 'Clear skies' },
      'Clouds': { r: 150, g: 150, b: 180, pattern: 'pulse', label: 'Cloudy' },
      'Rain': { r: 30, g: 100, b: 255, pattern: 'pulse', label: 'Rain' },
      'Drizzle': { r: 80, g: 140, b: 220, pattern: 'pulse', label: 'Drizzle' },
      'Thunderstorm': { r: 255, g: 50, b: 0, pattern: 'strobe', label: 'Storm' },
      'Snow': { r: 220, g: 230, b: 255, pattern: 'strobe', label: 'Snow' },
      'Mist': { r: 180, g: 180, b: 200, pattern: 'pulse', label: 'Mist' },
      'Fog': { r: 160, g: 160, b: 180, pattern: 'pulse', label: 'Fog' }
    };

    const cond = this.weatherData.condition;
    const cfg = condMap[cond] || { r: 200, g: 200, b: 200, pattern: 'pulse', label: cond };

    return this.notify({
      title: `Weather: ${cfg.label}`,
      message: `${this.weatherData.temp}C, ${this.weatherData.description}`,
      color: { r: cfg.r, g: cfg.g, b: cfg.b },
      pattern: cfg.pattern,
      duration: 5000,
      priority: 1
    });
  }

  // ---- Status ----

  getStatus() {
    return {
      apiKey: this.apiKey,
      profiles: this.profiles,
      historyCount: this.history.length,
      weather: {
        enabled: this.weatherConfig.enabled,
        city: this.weatherConfig.city,
        hasApiKey: !!this.weatherConfig.apiKey,
        data: this.weatherData
      }
    };
  }

  // ---- Shutdown ----

  stop() {
    if (this.weatherTimer) { clearInterval(this.weatherTimer); this.weatherTimer = null; }
  }

  // ---- Persistence ----

  _save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        profiles: this.profiles,
        apiKey: this.apiKey,
        weather: {
          apiKey: this.weatherConfig.apiKey,
          city: this.weatherConfig.city,
          enabled: this.weatherConfig.enabled
        }
      }, null, 2));
    } catch (e) {
      console.error('[Notify] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.profiles = data.profiles || {};
        this.apiKey = data.apiKey || this._generateKey();
        if (data.weather) {
          this.weatherConfig.apiKey = data.weather.apiKey || '';
          this.weatherConfig.city = data.weather.city || '';
          this.weatherConfig.enabled = data.weather.enabled || false;
        }
        console.log(`[Notify] Loaded ${Object.keys(this.profiles).length} profiles`);
      } else {
        // First run — generate API key and seed default profiles
        this.apiKey = this._generateKey();
        this.profiles = {
          alert: { r: 255, g: 0, b: 0, pattern: 'flash', duration: 5000, priority: 3 },
          info: { r: 0, g: 150, b: 255, pattern: 'pulse', duration: 3000, priority: 1 },
          success: { r: 0, g: 255, b: 100, pattern: 'pulse', duration: 3000, priority: 1 }
        };
        this._save();
        console.log(`[Notify] First run — generated API key and default profiles`);
      }
    } catch (e) {
      console.error('[Notify] Load error:', e.message);
      this.apiKey = this._generateKey();
    }
  }

  _generateKey() {
    // Cryptographically secure random hex key (16 bytes = 32 hex chars)
    const key = crypto.randomBytes(16).toString('hex');
    return key;
  }
}

module.exports = NotificationManager;
