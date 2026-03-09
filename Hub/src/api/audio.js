// ============================================================
// Audio API Routes
// ============================================================
// Controls audio capture: start/stop, sensitivity adjustment.
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/audio/status
router.get('/status', (req, res) => {
  const am = req.app.get('audioManager');
  res.json(am.getStatus());
});

// POST /api/audio/start
router.post('/start', (req, res) => {
  const am = req.app.get('audioManager');
  if (am.active) return res.json({ ok: true, status: 'already_running' });
  am.start();
  res.json({ ok: true, status: 'started' });
});

// POST /api/audio/stop
router.post('/stop', (req, res) => {
  const am = req.app.get('audioManager');
  am.stop();
  res.json({ ok: true, status: 'stopped' });
});

// POST /api/audio/sensitivity
router.post('/sensitivity', (req, res) => {
  const am = req.app.get('audioManager');
  const value = parseFloat(req.body.value);
  if (isNaN(value) || value < 1.0 || value > 3.0) {
    return res.status(400).json({ error: 'Sensitivity must be 1.0-3.0' });
  }
  am.setSensitivity(value);
  res.json({ ok: true, sensitivity: value });
});

module.exports = router;
