// ============================================================
// Hub Scene API Routes
// ============================================================
// CRUD operations for scenes + activation + scheduling.
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/scenes - List all scenes
router.get('/', (req, res) => {
  const sm = req.app.get('sceneManager');
  res.json(sm.list());
});

// GET /api/scenes/:name - Get a specific scene
router.get('/:name', (req, res) => {
  const sm = req.app.get('sceneManager');
  const scene = sm.get(req.params.name);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json({ name: req.params.name, ...scene });
});

// POST /api/scenes - Create scene from current device states
router.post('/', async (req, res) => {
  const sm = req.app.get('sceneManager');
  const { name, description } = req.body;

  if (!name) return res.status(400).json({ error: 'Missing scene name' });
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Name must be alphanumeric with dashes/underscores' });
  }

  try {
    const scene = await sm.capture(name, description || '');
    res.json({ ok: true, name, scene });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scenes/create - Create scene from explicit device states
router.post('/create', (req, res) => {
  const sm = req.app.get('sceneManager');
  const { name, description, devices } = req.body;

  if (!name || !devices) {
    return res.status(400).json({ error: 'Missing name or devices' });
  }

  const scene = sm.create(name, description || '', devices);
  res.json({ ok: true, name, scene });
});

// POST /api/scenes/:name/activate - Activate a saved scene
router.post('/:name/activate', async (req, res) => {
  const sm = req.app.get('sceneManager');

  try {
    const results = await sm.activate(req.params.name);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /api/scenes/:name - Delete a scene
router.delete('/:name', (req, res) => {
  const sm = req.app.get('sceneManager');
  const deleted = sm.delete(req.params.name);
  if (!deleted) return res.status(404).json({ error: 'Scene not found' });
  res.json({ ok: true });
});

// ---- Schedules ----

// GET /api/scenes/schedules/list - List all schedules
router.get('/schedules/list', (req, res) => {
  const sm = req.app.get('sceneManager');
  res.json(sm.listSchedules());
});

// POST /api/scenes/:name/schedule - Set a schedule for a scene
router.post('/:name/schedule', (req, res) => {
  const sm = req.app.get('sceneManager');
  const { cron: cronExpr, description } = req.body;

  if (!cronExpr) {
    return res.status(400).json({ error: 'Missing cron expression' });
  }

  try {
    const schedule = sm.setSchedule(req.params.name, cronExpr, description || '');
    res.json({ ok: true, schedule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/scenes/:name/schedule/toggle - Enable/disable a schedule
router.post('/:name/schedule/toggle', (req, res) => {
  const sm = req.app.get('sceneManager');
  const { enabled } = req.body;

  if (enabled === undefined) {
    return res.status(400).json({ error: 'Missing enabled field' });
  }

  try {
    const schedule = sm.toggleSchedule(req.params.name, enabled);
    res.json({ ok: true, schedule });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /api/scenes/:name/schedule - Remove a schedule
router.delete('/:name/schedule', (req, res) => {
  const sm = req.app.get('sceneManager');
  const removed = sm.removeSchedule(req.params.name);
  if (!removed) return res.status(404).json({ error: 'No schedule found' });
  res.json({ ok: true });
});

module.exports = router;
