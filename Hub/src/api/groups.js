// ============================================================
// Device Groups API Routes
// ============================================================

const express = require('express');
const router = express.Router();

// GET /api/groups — List all groups
router.get('/', (req, res) => {
  const gm = req.app.get('groupManager');
  res.json({ groups: gm.list() });
});

// POST /api/groups — Create/update a group
router.post('/', (req, res) => {
  const gm = req.app.get('groupManager');
  const { name, devices, description } = req.body;
  try {
    const group = gm.set(name, devices, description);
    res.json({ ok: true, group });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/groups/:name — Get group details
router.get('/:name', (req, res) => {
  const gm = req.app.get('groupManager');
  const group = gm.get(req.params.name);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json(group);
});

// DELETE /api/groups/:name — Delete a group
router.delete('/:name', (req, res) => {
  const gm = req.app.get('groupManager');
  const deleted = gm.delete(req.params.name);
  res.json({ ok: deleted });
});

// POST /api/groups/:name/pattern — Set pattern on all group devices
router.post('/:name/pattern', async (req, res) => {
  const gm = req.app.get('groupManager');
  const { id: patternId } = req.body;
  if (!patternId) return res.status(400).json({ error: 'Missing pattern id' });
  try {
    const results = await gm.executeOnGroup(req.params.name, '/api/pattern', { id: patternId });
    res.json({ ok: true, pattern: patternId, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/groups/:name/brightness — Set brightness on all group devices
router.post('/:name/brightness', async (req, res) => {
  const gm = req.app.get('groupManager');
  const { value, dir } = req.body;
  const params = value !== undefined ? { val: value } : { dir: dir || 'up' };
  try {
    const results = await gm.executeOnGroup(req.params.name, '/api/brightness', params);
    res.json({ ok: true, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/groups/:name/color — Set color on all group devices
router.post('/:name/color', async (req, res) => {
  const gm = req.app.get('groupManager');
  const dm = req.app.get('deviceManager');
  const { r, g, b } = req.body;
  if (r === undefined || g === undefined || b === undefined) {
    return res.status(400).json({ error: 'Missing r, g, b' });
  }
  try {
    const ids = gm.getOnlineDevices(req.params.name);
    const results = {};
    for (const id of ids) {
      try {
        await dm.sendColor(id, r, g, b);
        results[id] = 'ok';
      } catch (e) {
        results[id] = e.message;
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
