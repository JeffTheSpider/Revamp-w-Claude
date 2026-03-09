// ============================================================
// Circadian API Routes
// ============================================================
// Controls the circadian rhythm service and sunrise alarms.
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/circadian/status
router.get('/status', (req, res) => {
  const cm = req.app.get('circadianManager');
  res.json(cm.getStatus());
});

// POST /api/circadian/start
router.post('/start', (req, res) => {
  const cm = req.app.get('circadianManager');
  cm.start();
  res.json({ ok: true });
});

// POST /api/circadian/stop
router.post('/stop', (req, res) => {
  const cm = req.app.get('circadianManager');
  cm.stop();
  res.json({ ok: true });
});

// POST /api/circadian/alarm - Set a sunrise alarm
// Body: { hour: 7, minute: 0, devices: ["lamp"] }
router.post('/alarm', (req, res) => {
  const cm = req.app.get('circadianManager');
  const { hour, minute, devices } = req.body;
  if (hour === undefined || minute === undefined) {
    return res.status(400).json({ error: 'hour and minute required' });
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return res.status(400).json({ error: 'Invalid time' });
  }
  cm.setSunriseAlarm(hour, minute, devices || []);
  res.json({ ok: true, status: cm.getStatus() });
});

// DELETE /api/circadian/alarm - Remove a sunrise alarm
// Body: { hour: 7, minute: 0 }
router.delete('/alarm', (req, res) => {
  const cm = req.app.get('circadianManager');
  const { hour, minute } = req.body;
  const removed = cm.removeSunriseAlarm(hour, minute);
  res.json({ ok: removed, status: cm.getStatus() });
});

module.exports = router;
