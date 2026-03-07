// ============================================================
// Hub REST API Routes
// ============================================================
// Proxies commands to ESP devices. Provides device listing,
// pattern/brightness control, and scene management.
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/devices - List all devices with status
router.get('/devices', (req, res) => {
  const dm = req.app.get('deviceManager');
  res.json(dm.getAll());
});

// GET /api/devices/:id/status - Get single device status
router.get('/devices/:id/status', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const device = dm.get(req.params.id);

  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
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
router.get('/devices/:id/patterns', async (req, res) => {
  const dm = req.app.get('deviceManager');
  try {
    const patterns = await dm.sendCommand(req.params.id, '/api/patterns');
    res.json(patterns);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/devices/:id/pattern - Set pattern on device
router.post('/devices/:id/pattern', async (req, res) => {
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
router.post('/devices/:id/brightness', async (req, res) => {
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
router.post('/devices/all/brightness', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'Missing brightness value' });
  }

  const results = {};
  for (const device of dm.getAll()) {
    if (device.online) {
      try {
        await dm.sendCommand(device.id, '/api/brightness', { val: value });
        results[device.id] = 'ok';
      } catch (err) {
        results[device.id] = err.message;
      }
    } else {
      results[device.id] = 'offline';
    }
  }

  res.json({ brightness: value, results });
});

module.exports = router;
