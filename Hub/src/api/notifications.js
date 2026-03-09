// ============================================================
// Notification API Routes
// ============================================================
// Webhook endpoint for external services (IFTTT, Tasker, curl).
// Profile management, history, weather control.
// ============================================================

const express = require('express');
const router = express.Router();

// Middleware: API key auth for the webhook endpoint
function requireApiKey(req, res, next) {
  const nm = req.app.get('notificationManager');
  const key = req.query.key || req.headers['x-api-key'] || '';
  if (!nm.validateApiKey(key)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// POST /api/notify — External webhook (requires API key)
// Body: { title, message, color: {r,g,b}, pattern, duration, devices, priority, profile }
router.post('/notify', requireApiKey, async (req, res) => {
  const nm = req.app.get('notificationManager');
  try {
    const entry = await nm.notify(req.body);
    res.json({ ok: true, notification: entry });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/send — Internal send (no API key needed, from PWA)
router.post('/notifications/send', async (req, res) => {
  const nm = req.app.get('notificationManager');
  try {
    const entry = await nm.notify(req.body);
    res.json({ ok: true, notification: entry });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/test — Quick test notification
router.post('/notifications/test', async (req, res) => {
  const nm = req.app.get('notificationManager');
  try {
    const entry = await nm.notify({
      title: 'Test Notification',
      message: 'Testing LED notification',
      color: { r: 0, g: 255, b: 100 },
      pattern: 'flash',
      duration: 3000,
      priority: 2
    });
    res.json({ ok: true, notification: entry });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/notifications/status — Full status
router.get('/notifications/status', (req, res) => {
  const nm = req.app.get('notificationManager');
  res.json(nm.getStatus());
});

// GET /api/notifications/history — Notification history
router.get('/notifications/history', (req, res) => {
  const nm = req.app.get('notificationManager');
  const limit = parseInt(req.query.limit) || 20;
  res.json(nm.getHistory(limit));
});

// GET /api/notifications/config — Profiles + weather config
// Note: API key is shown for local network webhook URL display.
// Weather API key is redacted (only shows if set).
router.get('/notifications/config', (req, res) => {
  const nm = req.app.get('notificationManager');
  res.json({
    profiles: nm.getProfiles(),
    apiKey: nm.apiKey,
    weather: {
      city: nm.weatherConfig.city,
      enabled: nm.weatherConfig.enabled,
      hasApiKey: !!nm.weatherConfig.apiKey
    }
  });
});

// POST /api/notifications/config — Update config
// Body: { profiles, weather: { apiKey, city } }
router.post('/notifications/config', (req, res) => {
  const nm = req.app.get('notificationManager');
  if (req.body.profiles) {
    for (const [name, config] of Object.entries(req.body.profiles)) {
      nm.setProfile(name, config);
    }
  }
  if (req.body.weather) {
    nm.setWeatherConfig(req.body.weather);
  }
  res.json({ ok: true, status: nm.getStatus() });
});

// POST /api/notifications/weather/start
router.post('/notifications/weather/start', (req, res) => {
  const nm = req.app.get('notificationManager');
  const started = nm.startWeather();
  res.json({ ok: started, status: nm.getStatus() });
});

// POST /api/notifications/weather/stop
router.post('/notifications/weather/stop', (req, res) => {
  const nm = req.app.get('notificationManager');
  nm.stopWeather();
  res.json({ ok: true, status: nm.getStatus() });
});

// POST /api/notifications/weather/notify — Trigger weather notification now
router.post('/notifications/weather/notify', async (req, res) => {
  const nm = req.app.get('notificationManager');
  try {
    const entry = await nm.weatherNotify();
    if (entry) {
      res.json({ ok: true, notification: entry });
    } else {
      res.status(400).json({ error: 'No weather data available' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/key/regenerate — Generate new API key
router.post('/notifications/key/regenerate', (req, res) => {
  const nm = req.app.get('notificationManager');
  const key = nm.regenerateApiKey();
  res.json({ ok: true, apiKey: key });
});

module.exports = router;
