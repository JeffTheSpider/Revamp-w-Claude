// ============================================================
// Hub REST API Routes
// ============================================================
// Proxies commands to ESP devices. Provides device listing,
// pattern/brightness control, and scene management.
// IMPORTANT: /devices/all/* routes MUST come before /devices/:id/*
// to prevent Express matching "all" as a device ID.
// ============================================================

const express = require('express');
const router = express.Router();

// Validate device ID parameter (must exist in device manager)
function validateDeviceId(req, res, next) {
  const dm = req.app.get('deviceManager');
  const device = dm.get(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Unknown device: ' + req.params.id });
  }
  next();
}

// GET /api/devices - List all devices with status
router.get('/devices', (req, res) => {
  const dm = req.app.get('deviceManager');
  res.json(dm.getAll());
});

// ============================================================
// All-Devices Routes (MUST be before :id routes)
// ============================================================

// POST /api/devices/all/pattern - Set pattern on all devices
router.post('/devices/all/pattern', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { id: patternId } = req.body;

  if (!patternId) {
    return res.status(400).json({ error: 'Missing pattern id' });
  }

  const results = {};
  for (const device of dm.getAll()) {
    if (device.online) {
      try {
        await dm.sendCommand(device.id, '/api/pattern', { id: patternId });
        results[device.id] = 'ok';
      } catch (err) {
        results[device.id] = err.message;
      }
    } else {
      results[device.id] = 'offline';
    }
  }

  res.json({ pattern: patternId, results });
});

// POST /api/devices/all/brightness - Set brightness on all devices
// Supports { value: N } for absolute or { dir: 'up'|'down' } for relative
router.post('/devices/all/brightness', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { value, dir } = req.body;

  if (value === undefined && !dir) {
    return res.status(400).json({ error: 'Missing brightness value or dir' });
  }

  const params = value !== undefined ? { val: value } : { dir: dir };
  const results = {};
  for (const device of dm.getAll()) {
    if (device.online) {
      try {
        await dm.sendCommand(device.id, '/api/brightness', params);
        results[device.id] = 'ok';
      } catch (err) {
        results[device.id] = err.message;
      }
    } else {
      results[device.id] = 'offline';
    }
  }

  res.json({ brightness: value || dir, results });
});

// POST /api/devices/all/color - Set color on all devices
router.post('/devices/all/color', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { r, g, b } = req.body;

  if (r === undefined || g === undefined || b === undefined) {
    return res.status(400).json({ error: 'Missing r, g, b values' });
  }

  const results = {};
  for (const device of dm.getAll()) {
    if (device.online) {
      try {
        await dm.sendColor(device.id, r, g, b);
        results[device.id] = 'ok';
      } catch (err) {
        results[device.id] = err.message;
      }
    } else {
      results[device.id] = 'offline';
    }
  }

  res.json({ color: { r, g, b }, results });
});

// POST /api/devices/all/restart - Restart all online devices
router.post('/devices/all/restart', async (req, res) => {
  const dm = req.app.get('deviceManager');

  const results = {};
  for (const device of dm.getAll()) {
    if (device.online) {
      try {
        await dm.sendCommand(device.id, '/restart');
        results[device.id] = 'ok';
      } catch (err) {
        results[device.id] = err.message;
      }
    } else {
      results[device.id] = 'offline';
    }
  }

  res.json({ action: 'restart', results });
});

// ============================================================
// Single-Device Routes
// ============================================================

// GET /api/devices/:id/status - Get single device status
router.get('/devices/:id/status', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  const device = dm.get(req.params.id);

  if (!device.online) {
    return res.status(503).json({ error: 'Device offline' });
  }

  try {
    const status = await dm.sendCommand(req.params.id, '/api/status');
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/devices/:id/patterns - List device patterns
router.get('/devices/:id/patterns', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  try {
    const patterns = await dm.sendCommand(req.params.id, '/api/patterns');
    res.json(patterns);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/pattern - Set pattern on device
router.post('/devices/:id/pattern', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { id: patternId } = req.body;

  if (!patternId) {
    return res.status(400).json({ error: 'Missing pattern id' });
  }

  try {
    await dm.sendCommand(req.params.id, '/api/pattern', { id: patternId });
    res.json({ ok: true, pattern: patternId });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/brightness - Set brightness on device
router.post('/devices/:id/brightness', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { value, dir } = req.body;

  try {
    const params = value !== undefined ? { val: value } : { dir: dir || 'up' };
    await dm.sendCommand(req.params.id, '/api/brightness', params);
    res.json({ ok: true, brightness: value || dir });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/color - Set custom RGB color on device
router.post('/devices/:id/color', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { r, g, b } = req.body;

  if (r === undefined || g === undefined || b === undefined) {
    return res.status(400).json({ error: 'Missing r, g, b values' });
  }

  try {
    await dm.sendColor(req.params.id, r, g, b);
    res.json({ ok: true, color: { r, g, b } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/restart - Restart a device
router.post('/devices/:id/restart', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  try {
    await dm.sendCommand(req.params.id, '/restart');
    res.json({ ok: true, action: 'restarting' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/morse - Send morse code to device (lamp only)
router.post('/devices/:id/morse', validateDeviceId, async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { text, wpm, loop, stop, r, g, b } = req.body;

  if (stop) {
    try {
      await dm.sendCommand(req.params.id, '/api/morse', { stop: 1 });
      return res.json({ ok: true, action: 'stopped' });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  try {
    const params = { text };
    if (wpm) params.wpm = wpm;
    if (loop) params.loop = '1';
    if (r !== undefined) params.r = r;
    if (g !== undefined) params.g = g;
    if (b !== undefined) params.b = b;
    const result = await dm.sendCommand(req.params.id, '/api/morse', params);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
