// ============================================================
// Revamp Hub - Central Control Server
// ============================================================
// Express + WebSocket server that discovers and proxies ESP
// devices (Clock/Lamp). Serves PWA control panel.
//
// Usage: npm start (port 3000)
// Dev:   npm run dev (auto-restart on changes)
// ============================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const DeviceManager = require('./src/services/device-manager');
const SceneManager = require('./src/services/scene-manager');
const apiRoutes = require('./src/api/routes');
const sceneRoutes = require('./src/api/scenes');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// WebSocket server on same HTTP server
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Device manager (discovers and polls ESP devices)
const deviceManager = new DeviceManager();

// Scene manager (save/load device state snapshots)
const sceneManager = new SceneManager(deviceManager);

// Make managers available to routes
app.set('deviceManager', deviceManager);
app.set('sceneManager', sceneManager);

// API routes
app.use('/api', apiRoutes);
app.use('/api/scenes', sceneRoutes);

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (total: ${wss.clients.size})`);

  // Send current device states on connect
  const devices = deviceManager.getAll();
  ws.send(JSON.stringify({ type: 'devices', data: devices }));

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

// Handle incoming WebSocket messages from clients
function handleWsMessage(ws, msg) {
  switch (msg.type) {
    case 'color_update':
      // Real-time color update from PWA color picker
      if (msg.device && msg.r !== undefined) {
        deviceManager.sendColor(msg.device, msg.r, msg.g, msg.b);
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

    default:
      console.log('[WS] Unknown message type:', msg.type);
  }
}

// Broadcast device status updates to all WebSocket clients
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

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

// Broadcast scheduled scene activations to all clients
sceneManager.on('scheduledActivation', (name, results) => {
  broadcast({ type: 'scene_activated', name, results, scheduled: true });
});

// Graceful shutdown: stop cron jobs
process.on('SIGTERM', () => {
  sceneManager.stopAll();
  deviceManager.stop();
  server.close();
});

// Start server
server.listen(PORT, () => {
  console.log(`[Hub] Server running on http://localhost:${PORT}`);
  console.log(`[Hub] WebSocket on ws://localhost:${PORT}/ws`);
  deviceManager.start();
});
