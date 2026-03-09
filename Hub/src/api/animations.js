// ============================================================
// Animation API Routes
// ============================================================
// CRUD for saved animations, upload to devices, playback control.
// Used by the PWA animation designer UI.
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/animations/status — Get animation playback status
// (Must be before /:name to avoid matching "status" as a name)
router.get('/animations/status', (req, res) => {
  const am = req.app.get('animationManager');
  res.json(am.getStatus());
});

// POST /api/animations/play — Play animation on device(s)
// Body: { name, device: "id" | "all", loop: bool }
router.post('/animations/play', async (req, res) => {
  const am = req.app.get('animationManager');
  const { name, device = 'all', loop } = req.body;
  try {
    let result;
    if (device === 'all') {
      result = await am.playOnAll(name, { loop });
    } else {
      result = await am.playAnimation(name, device, { loop });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/animations/stop — Stop animation on device(s)
// Body: { device: "id" | "all", revertMode: "candle" }
router.post('/animations/stop', async (req, res) => {
  const am = req.app.get('animationManager');
  const { device = 'all', revertMode = 'candle' } = req.body;
  try {
    if (device === 'all') {
      await am.stopAll(revertMode);
    } else {
      await am.stopAnimation(device, revertMode);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/animations — List all saved animations
router.get('/animations', (req, res) => {
  const am = req.app.get('animationManager');
  res.json({ animations: am.listAnimations() });
});

// POST /api/animations — Save a new/updated animation
// Body: { name, duration, loop, keyframes: [{ time, leds, r, g, b }] }
router.post('/animations', (req, res) => {
  const am = req.app.get('animationManager');
  try {
    const saved = am.saveAnimation(req.body.name, req.body);
    res.json({ ok: true, animation: saved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/animations/:name — Get full animation data
router.get('/animations/:name', (req, res) => {
  const am = req.app.get('animationManager');
  const anim = am.getAnimation(req.params.name);
  if (!anim) return res.status(404).json({ error: 'Not found' });
  res.json(anim);
});

// DELETE /api/animations/:name — Delete a saved animation
router.delete('/animations/:name', (req, res) => {
  const am = req.app.get('animationManager');
  const deleted = am.deleteAnimation(req.params.name);
  res.json({ ok: deleted });
});

module.exports = router;
