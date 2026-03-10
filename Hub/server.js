// ============================================================
// Revamp Hub - Central Control Server
// ============================================================
// Express + WebSocket server that discovers and proxies ESP
// devices (Clock/Lamp). Serves PWA control panel.
//
// Usage: npm start (port 3000)
// Dev:   npm run dev (auto-restart on changes)
// ============================================================

// Load .env before anything else
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const FileLogger = require('./src/middleware/logger');
const createAuthMiddleware = require('./src/middleware/auth');
const DeviceManager = require('./src/services/device-manager');
const SceneManager = require('./src/services/scene-manager');
const AudioManager = require('./src/services/audio-manager');
const CircadianManager = require('./src/services/circadian-manager');
const NotificationManager = require('./src/services/notification-manager');
const AnimationManager = require('./src/services/animation-manager');
const GroupManager = require('./src/services/group-manager');
const apiRoutes = require('./src/api/routes');
const sceneRoutes = require('./src/api/scenes');
const audioRoutes = require('./src/api/audio');
const circadianRoutes = require('./src/api/circadian');
const notificationRoutes = require('./src/api/notifications');
const animationRoutes = require('./src/api/animations');
const systemRoutes = require('./src/api/system');
const groupRoutes = require('./src/api/groups');

// ---- Config ----

const CONFIG_PATH = path.join(__dirname, 'config.json');
let hubConfig = {};
try { hubConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
const PORT = process.env.PORT || hubConfig.port || 3000;

// ---- File Logger ----

const logger = new FileLogger(process.env.LOG_DIR || './logs');

// ---- Express App ----

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- Middleware ----

// CORS — allow same-origin and LAN access
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware (optional, enabled if HUB_AUTH_TOKEN is set)
const authToken = process.env.HUB_AUTH_TOKEN || '';
app.use('/api', createAuthMiddleware(authToken));

// Rate limiting (100 requests per 10s per IP)
const rateLimitMap = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > 10000) {
    entry = { start: now, count: 1 };
    rateLimitMap.set(ip, entry);
  } else {
    entry.count++;
  }
  if (entry.count > 100) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  next();
});
setInterval(() => {
  const cutoff = Date.now() - 10000;
  for (const [ip, entry] of rateLimitMap) {
    if (entry.start < cutoff) rateLimitMap.delete(ip);
  }
}, 30000);

// Slow request logging
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 1000) {
      console.log(`[API] ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms SLOW)`);
    }
  });
  next();
});

// ---- Services ----

const deviceManager = new DeviceManager();
const sceneManager = new SceneManager(deviceManager);
const audioManager = new AudioManager();
const circadianManager = new CircadianManager(deviceManager);
const notificationManager = new NotificationManager(deviceManager);
const animationManager = new AnimationManager(deviceManager);
const groupManager = new GroupManager(deviceManager);

app.set('deviceManager', deviceManager);
app.set('sceneManager', sceneManager);
app.set('audioManager', audioManager);
app.set('circadianManager', circadianManager);
app.set('notificationManager', notificationManager);
app.set('animationManager', animationManager);
app.set('groupManager', groupManager);

// ---- API Routes ----

app.use('/api', systemRoutes);
app.use('/api', apiRoutes);
app.use('/api/scenes', sceneRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/circadian', circadianRoutes);
app.use('/api', notificationRoutes);
app.use('/api', animationRoutes);
app.use('/api/groups', groupRoutes);

// Global API error handler
app.use('/api', (err, req, res, _next) => {
  console.error(`[API] Error on ${req.method} ${req.originalUrl}:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Config Hot-Reload ----

let configReloadTimer = null;
fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => {
  clearTimeout(configReloadTimer);
  configReloadTimer = setTimeout(() => {
    try {
      JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      console.log('[Hub] Config file changed (restart Hub to apply)');
    } catch (e) {
      console.error('[Hub] Config reload failed:', e.message);
    }
  }, 1000);
});

// ---- WebSocket ----

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (total: ${wss.clients.size})`);

  // Send current states on connect
  ws.send(JSON.stringify({ type: 'devices', data: deviceManager.getAll() }));
  ws.send(JSON.stringify({ type: 'audio_status', data: audioManager.getStatus() }));
  ws.send(JSON.stringify({ type: 'circadian_status', data: circadianManager.getStatus() }));
  ws.send(JSON.stringify({ type: 'notification_status', data: notificationManager.getStatus() }));
  ws.send(JSON.stringify({ type: 'animation_status', data: animationManager.getStatus() }));
  ws.send(JSON.stringify({ type: 'groups', data: groupManager.list() }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(ws, msg);
    } catch (e) {
      console.error('[WS] Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected (total: ${wss.clients.size})`);
  });
});

// Throttle map for color updates
const colorThrottle = new Map();
const COLOR_THROTTLE_MS = 50;

function handleWsMessage(ws, msg) {
  switch (msg.type) {
    case 'color_update':
      if (msg.device && msg.r !== undefined) {
        const now = Date.now();
        const lastSend = colorThrottle.get(msg.device) || 0;
        if (now - lastSend >= COLOR_THROTTLE_MS) {
          colorThrottle.set(msg.device, now);
          deviceManager.sendColor(msg.device, msg.r, msg.g, msg.b)
            .catch(() => {});
        }
      }
      break;

    case 'get_devices':
      ws.send(JSON.stringify({ type: 'devices', data: deviceManager.getAll() }));
      break;

    case 'get_scenes':
      ws.send(JSON.stringify({ type: 'scenes', data: sceneManager.list() }));
      break;

    case 'activate_scene':
      if (msg.name) {
        sceneManager.activate(msg.name).then(results => {
          ws.send(JSON.stringify({ type: 'scene_activated', name: msg.name, results }));
        }).catch(err => {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        });
      }
      break;

    case 'audio_start': audioManager.start(); break;
    case 'audio_stop': audioManager.stop(); break;

    case 'audio_sensitivity':
      if (msg.value !== undefined) audioManager.setSensitivity(parseFloat(msg.value));
      break;

    case 'circadian_start': circadianManager.start(); break;
    case 'circadian_stop': circadianManager.stop(); break;

    case 'sunrise_alarm_set':
      if (msg.hour !== undefined && msg.minute !== undefined) {
        circadianManager.setSunriseAlarm(msg.hour, msg.minute, msg.devices || []);
      }
      break;

    case 'sunrise_alarm_remove':
      if (msg.hour !== undefined && msg.minute !== undefined) {
        circadianManager.removeSunriseAlarm(msg.hour, msg.minute);
      }
      break;

    case 'notification_test':
      notificationManager.notify({
        title: 'Test', message: 'Test notification',
        color: { r: 0, g: 255, b: 100 }, pattern: 'flash', duration: 3000, priority: 2
      }).catch(() => {});
      break;

    case 'notification_send':
      if (msg.config) notificationManager.notify(msg.config).catch(() => {});
      break;

    case 'weather_notify':
      notificationManager.weatherNotify().catch(() => {});
      break;

    case 'animation_play':
      if (msg.name) {
        animationManager.playOnAll(msg.name, { loop: msg.loop })
          .then(() => broadcast({ type: 'animation_status', data: animationManager.getStatus() }))
          .catch(() => {});
      }
      break;

    case 'animation_stop':
      animationManager.stopAll(msg.revertMode || 'candle')
        .then(() => broadcast({ type: 'animation_status', data: animationManager.getStatus() }))
        .catch(() => {});
      break;

    // Group commands via WebSocket
    case 'group_pattern':
      if (msg.group && msg.pattern) {
        groupManager.executeOnGroup(msg.group, '/api/pattern', { id: msg.pattern })
          .then(r => ws.send(JSON.stringify({ type: 'group_result', group: msg.group, results: r })))
          .catch(e => ws.send(JSON.stringify({ type: 'error', message: e.message })));
      }
      break;

    case 'group_brightness':
      if (msg.group) {
        const params = msg.value !== undefined ? { val: msg.value } : { dir: msg.dir || 'up' };
        groupManager.executeOnGroup(msg.group, '/api/brightness', params).catch(() => {});
      }
      break;

    default:
      console.log('[WS] Unknown message type:', msg.type);
  }
}

// ---- Event Broadcasting ----

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

deviceManager.on('statusUpdate', (deviceId, status) => {
  const msg = JSON.stringify({ type: 'device_status', id: deviceId, data: status });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
});

deviceManager.on('deviceOnline', (deviceId) => {
  console.log(`[Hub] Device online: ${deviceId}`);
  broadcast({ type: 'device_online', id: deviceId });
});

deviceManager.on('deviceOffline', (deviceId) => {
  console.log(`[Hub] Device offline: ${deviceId}`);
  broadcast({ type: 'device_offline', id: deviceId });
});

sceneManager.on('scheduledActivation', (name, results) => {
  broadcast({ type: 'scene_activated', name, results, scheduled: true });
});
sceneManager.on('sceneSaved', () => {
  broadcast({ type: 'scenes', data: sceneManager.list() });
});
sceneManager.on('sceneDeleted', () => {
  broadcast({ type: 'scenes', data: sceneManager.list() });
});

audioManager.on('audioData', (data) => {
  const msg = JSON.stringify({ type: 'audio_data', ...data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
});
audioManager.on('started', () => {
  broadcast({ type: 'audio_status', data: audioManager.getStatus() });
});
audioManager.on('stopped', (info) => {
  broadcast({ type: 'audio_status', data: audioManager.getStatus() });
  if (info.reason !== 'user') {
    console.log(`[Hub] Audio stopped: ${info.reason}${info.error ? ' - ' + info.error : ''}`);
  }
});

circadianManager.on('started', () => {
  broadcast({ type: 'circadian_status', data: circadianManager.getStatus() });
});
circadianManager.on('stopped', () => {
  broadcast({ type: 'circadian_status', data: circadianManager.getStatus() });
});
circadianManager.on('kelvinUpdate', (kelvin) => {
  broadcast({ type: 'circadian_kelvin', kelvin });
});
circadianManager.on('sunriseTriggered', (alarm) => {
  broadcast({ type: 'sunrise_triggered', alarm: `${alarm.hour}:${String(alarm.minute).padStart(2, '0')}` });
});
circadianManager.on('alarmSet', () => {
  broadcast({ type: 'circadian_status', data: circadianManager.getStatus() });
});

notificationManager.on('notificationSent', (entry) => {
  broadcast({ type: 'notification_sent', data: entry });
  broadcast({ type: 'notification_status', data: notificationManager.getStatus() });
});
notificationManager.on('weatherUpdate', (data) => {
  broadcast({ type: 'weather_update', data });
});

animationManager.on('animationSaved', () => {
  broadcast({ type: 'animation_status', data: animationManager.getStatus() });
});
animationManager.on('animationDeleted', () => {
  broadcast({ type: 'animation_status', data: animationManager.getStatus() });
});
animationManager.on('animationPlaying', (info) => {
  broadcast({ type: 'animation_playing', data: info });
});
animationManager.on('animationStopped', () => {
  broadcast({ type: 'animation_status', data: animationManager.getStatus() });
});

groupManager.on('groupSaved', () => {
  broadcast({ type: 'groups', data: groupManager.list() });
});
groupManager.on('groupDeleted', () => {
  broadcast({ type: 'groups', data: groupManager.list() });
});

// ---- Graceful Shutdown ----

function shutdown() {
  console.log('[Hub] Shutting down...');
  fs.unwatchFile(CONFIG_PATH);
  audioManager.stop();
  circadianManager.stop();
  notificationManager.stop();
  sceneManager.stopAll();
  deviceManager.stop();
  logger.close();
  server.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  console.error('[Hub] Unhandled rejection:', reason);
});

// ---- Start ----

server.listen(PORT, () => {
  console.log(`[Hub] Server running on http://localhost:${PORT}`);
  console.log(`[Hub] WebSocket on ws://localhost:${PORT}/ws`);
  if (authToken) console.log('[Hub] Auth enabled (Bearer token required)');
  deviceManager.start();
});
