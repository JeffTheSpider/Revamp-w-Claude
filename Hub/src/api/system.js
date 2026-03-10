// ============================================================
// System API Routes
// ============================================================
// Health check, backup/restore, OTA trigger, OLED messages,
// firmware version info.
// ============================================================

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HUB_ROOT = path.join(__dirname, '..', '..');
const BACKUP_FILES = ['scenes.json', 'animations.json', 'notifications.json', 'groups.json', 'config.json'];

// GET /api/health — Always public, no auth required
router.get('/health', (req, res) => {
  const dm = req.app.get('deviceManager');
  const devices = dm.getAll();
  const online = devices.filter(d => d.online);

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal
    },
    devices: {
      total: devices.length,
      online: online.length,
      list: online.map(d => ({
        id: d.id,
        ip: d.ip,
        version: d.status?.version,
        heap: d.status?.freeHeap
      }))
    },
    services: {
      audio: req.app.get('audioManager')?.active || false,
      circadian: req.app.get('circadianManager')?.enabled || false,
      weather: req.app.get('notificationManager')?.weatherConfig?.enabled || false
    },
    timestamp: new Date().toISOString()
  });
});

// GET /api/system/backup — Download all config as JSON
router.get('/system/backup', (req, res) => {
  const backup = {};
  for (const file of BACKUP_FILES) {
    const filePath = path.join(HUB_ROOT, file);
    try {
      if (fs.existsSync(filePath)) {
        backup[file] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (_) {}
  }
  backup._meta = {
    createdAt: new Date().toISOString(),
    version: require(path.join(HUB_ROOT, 'package.json')).version
  };
  res.setHeader('Content-Disposition', 'attachment; filename="hub-backup.json"');
  res.json(backup);
});

// POST /api/system/restore — Restore config from backup JSON
router.post('/system/restore', (req, res) => {
  const backup = req.body;
  if (!backup || !backup._meta) {
    return res.status(400).json({ error: 'Invalid backup format' });
  }
  const restored = [];
  for (const file of BACKUP_FILES) {
    if (backup[file]) {
      try {
        const filePath = path.join(HUB_ROOT, file);
        fs.writeFileSync(filePath, JSON.stringify(backup[file], null, 2));
        restored.push(file);
      } catch (e) {
        console.error(`[System] Restore failed for ${file}:`, e.message);
      }
    }
  }
  res.json({ ok: true, restored, note: 'Restart Hub to apply restored config' });
});

// POST /api/system/oled — Send custom text to Clock OLED
router.post('/system/oled', async (req, res) => {
  const dm = req.app.get('deviceManager');
  const { text = '', line = 0, device = 'mirror' } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });
  try {
    const result = await dm.sendCommand(device, '/api/oled', { text, line });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/system/ota — Trigger OTA firmware update on a device
router.post('/system/ota', async (req, res) => {
  const { device, firmware } = req.body;
  if (!device || !firmware) {
    return res.status(400).json({ error: 'Missing device or firmware path' });
  }

  // Resolve firmware path
  const fwPath = path.resolve(firmware);
  if (!fs.existsSync(fwPath)) {
    return res.status(400).json({ error: 'Firmware file not found: ' + fwPath });
  }

  const dm = req.app.get('deviceManager');
  const dev = dm.get(device);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });

  // Find espota.py
  const espotaPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools/espota.py'
  );

  if (!fs.existsSync(espotaPath)) {
    return res.status(500).json({ error: 'espota.py not found at: ' + espotaPath });
  }

  // Run OTA upload as background process
  const args = [espotaPath, '-i', dev.ip, '-p', '8266', '-P', '48266', '-f', fwPath, '-d'];
  console.log(`[OTA] Starting upload to ${device} (${dev.ip}): ${fwPath}`);

  const proc = spawn('python3', args, { stdio: 'pipe' });
  let output = '';
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { output += d.toString(); });
  proc.on('close', code => {
    if (code === 0) {
      console.log(`[OTA] Upload to ${device} succeeded`);
    } else {
      console.error(`[OTA] Upload to ${device} failed (code ${code}): ${output.slice(-200)}`);
    }
  });

  // Return immediately (OTA runs in background)
  res.json({ ok: true, message: `OTA upload started for ${device}`, ip: dev.ip });
});

// GET /api/system/firmware — Get firmware build info for available binaries
router.get('/system/firmware', (req, res) => {
  const builds = {};
  const buildDirs = {
    mirror: path.join(HUB_ROOT, '..', 'Clock', 'clock_v2', 'build'),
    lamp: path.join(HUB_ROOT, '..', 'Lamp', 'lamp_v1', 'build')
  };

  for (const [device, dir] of Object.entries(buildDirs)) {
    try {
      const binFiles = fs.readdirSync(dir).filter(f => f.endsWith('.bin'));
      if (binFiles.length > 0) {
        const binPath = path.join(dir, binFiles[0]);
        const stat = fs.statSync(binPath);
        builds[device] = {
          file: binFiles[0],
          path: binPath,
          size: stat.size,
          modified: stat.mtime.toISOString()
        };
      }
    } catch (_) {}
  }

  res.json({ builds });
});

module.exports = router;
