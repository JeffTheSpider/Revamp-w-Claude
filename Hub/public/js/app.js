// ============================================================
// Revamp Hub - PWA Client
// ============================================================
// WebSocket client that renders device cards with live status,
// pattern selection, brightness slider, and color picker.
// Uses safe DOM methods throughout (no innerHTML).
// ============================================================

let ws = null;
let devices = [];
let scenes = [];
let reconnectTimer = null;
let patternCache = {}; // deviceId -> [patterns]

// ---- WebSocket ----

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Connected';
    el.className = 'connected';
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  };

  ws.onclose = () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Disconnected \u2013 reconnecting...';
    el.className = 'disconnected';
    if (!reconnectTimer) reconnectTimer = setInterval(connect, 3000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'devices':
      devices = msg.data;
      renderDevices();
      fetchScenes(); // Refresh scenes when device list updates
      break;
    case 'device_status':
      updateDevice(msg.id, msg.data);
      break;
    case 'device_online':
    case 'device_offline':
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'get_devices' }));
      }
      break;
    case 'scenes':
      scenes = msg.data;
      renderScenes();
      break;
    case 'scene_activated':
      showToast('Scene "' + msg.name + '" activated', 'success');
      // Refresh device states after scene activation
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'get_devices' }));
      }
      break;
    case 'error':
      showToast(msg.message || 'An error occurred', 'error');
      break;
  }
}

function updateDevice(id, data) {
  const idx = devices.findIndex(d => d.id === id);
  if (idx >= 0) { devices[idx] = data; renderDevices(); }
}

// ---- Rendering ----

function renderDevices() {
  const container = document.getElementById('devices');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (devices.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'text-align:center;color:#777;font-size:13px';
    p.textContent = 'No devices found';
    container.appendChild(p);
    return;
  }

  devices.forEach(dev => container.appendChild(createDeviceCard(dev)));

  // Show "All Devices" section if any online
  const hasOnline = devices.some(d => d.online);
  document.getElementById('all-section').style.display = hasOnline ? '' : 'none';
  if (hasOnline) renderAllPatterns();
}

function createDeviceCard(dev) {
  const card = el('div', 'device-card ' + (dev.online ? 'online' : 'offline'));

  // Header row
  const header = el('div', 'device-header');
  const name = el('span', 'device-name');
  name.appendChild(el('span', 'status-dot ' + (dev.online ? 'on' : 'off')));
  name.appendChild(document.createTextNode(dev.name));
  header.appendChild(name);

  if (dev.online && dev.status) {
    const mode = el('span', 'device-mode');
    mode.textContent = dev.status.modeName || dev.status.mode;
    header.appendChild(mode);
  }
  card.appendChild(header);

  if (!dev.online) {
    const msg = el('p', 'offline-msg');
    msg.textContent = 'Device offline';
    card.appendChild(msg);
    return card;
  }

  const s = dev.status;
  if (!s) return card;

  // Info grid
  const info = el('div', 'device-info');
  addInfoItem(info, 'IP', s.ip);
  addInfoItem(info, 'Heap', formatBytes(s.freeHeap));
  addInfoItem(info, 'WiFi', s.rssi + ' dBm');
  addInfoItem(info, 'Uptime', formatUptime(s.uptime));
  addInfoItem(info, 'Version', 'v' + s.version);
  addInfoItem(info, 'NTP', s.ntpValid ? '\u2713 Synced' : 'Pending');
  card.appendChild(info);

  // Pattern grid
  const patLabel = el('div', 'section-label');
  patLabel.textContent = 'Pattern';
  card.appendChild(patLabel);
  const patGrid = el('div', 'pattern-grid');
  patGrid.id = 'patterns-' + dev.id;
  card.appendChild(patGrid);
  fetchPatterns(dev);

  // Brightness slider
  const brLabel = el('div', 'section-label');
  brLabel.textContent = 'Brightness';
  card.appendChild(brLabel);
  const brSection = el('div', 'brightness-section');
  const brRow = el('div', 'brightness-row');

  const brDown = el('button', 'br-btn');
  brDown.textContent = '\u2212';
  brDown.onclick = () => setBrightness(dev.id, 'down');

  const brSlider = document.createElement('input');
  brSlider.type = 'range';
  brSlider.className = 'br-slider';
  brSlider.min = '1';
  brSlider.max = '250';
  brSlider.value = String(s.brightness);
  let sliderTimeout = null;
  brSlider.oninput = () => {
    brVal.textContent = brSlider.value;
    clearTimeout(sliderTimeout);
    sliderTimeout = setTimeout(() => {
      setBrightnessVal(dev.id, parseInt(brSlider.value));
    }, 150);
  };

  const brVal = el('span', 'br-val');
  brVal.textContent = String(s.brightness);

  const brUp = el('button', 'br-btn');
  brUp.textContent = '+';
  brUp.onclick = () => setBrightness(dev.id, 'up');

  brRow.appendChild(brDown);
  brRow.appendChild(brSlider);
  brRow.appendChild(brVal);
  brRow.appendChild(brUp);
  brSection.appendChild(brRow);
  card.appendChild(brSection);

  // Color picker
  const colorLabel = el('div', 'section-label');
  colorLabel.textContent = 'Custom Color';
  card.appendChild(colorLabel);
  const colorSection = el('div', 'color-section');
  const colorRow = el('div', 'color-row');

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'color-input';
  colorInput.value = '#ff6600';
  let colorTimeout = null;
  colorInput.oninput = () => {
    clearTimeout(colorTimeout);
    colorTimeout = setTimeout(() => {
      const hex = colorInput.value;
      const r = parseInt(hex.substr(1, 2), 16);
      const g = parseInt(hex.substr(3, 2), 16);
      const b = parseInt(hex.substr(5, 2), 16);
      sendColor(dev.id, r, g, b);
    }, 80);
  };

  const presets = el('div', 'color-presets');
  const presetColors = [
    '#ff0000', '#ff6600', '#ffcc00', '#00ff00',
    '#00ffcc', '#0088ff', '#8800ff', '#ff00aa',
    '#ffffff', '#ff4400'
  ];
  presetColors.forEach(color => {
    const swatch = document.createElement('button');
    swatch.className = 'color-preset';
    swatch.style.background = color;
    swatch.onclick = () => {
      colorInput.value = color;
      const r = parseInt(color.substr(1, 2), 16);
      const g = parseInt(color.substr(3, 2), 16);
      const b = parseInt(color.substr(5, 2), 16);
      sendColor(dev.id, r, g, b);
    };
    presets.appendChild(swatch);
  });

  colorRow.appendChild(colorInput);
  colorRow.appendChild(presets);
  colorSection.appendChild(colorRow);
  card.appendChild(colorSection);

  // Morse code section (lamp only - has strips/ledCount in status)
  if (s.strips || dev.id === 'lamp') {
    const morseLabel = el('div', 'section-label');
    morseLabel.textContent = 'Morse Code';
    card.appendChild(morseLabel);
    const morseSection = el('div', 'morse-section');

    const morseRow = el('div', 'morse-row');
    const morseInput = document.createElement('input');
    morseInput.type = 'text';
    morseInput.className = 'morse-input';
    morseInput.placeholder = 'Type a message...';
    morseInput.maxLength = 62;

    const morseWpm = document.createElement('select');
    morseWpm.className = 'morse-wpm';
    [8, 10, 12, 15, 20, 25].forEach(w => {
      const opt = document.createElement('option');
      opt.value = String(w);
      opt.textContent = w + ' WPM';
      if (w === 12) opt.selected = true;
      morseWpm.appendChild(opt);
    });

    const morseLoop = document.createElement('label');
    morseLoop.className = 'morse-loop-label';
    const loopCb = document.createElement('input');
    loopCb.type = 'checkbox';
    loopCb.className = 'morse-loop-cb';
    morseLoop.appendChild(loopCb);
    morseLoop.appendChild(document.createTextNode(' Loop'));

    const morseSend = el('button', 'morse-send-btn');
    morseSend.textContent = 'Send';
    morseSend.onclick = () => {
      const text = morseInput.value.trim();
      if (!text) return;
      sendMorse(dev.id, text, parseInt(morseWpm.value), loopCb.checked);
      morseSend.textContent = 'Sending...';
      setTimeout(() => { morseSend.textContent = 'Send'; }, 1000);
    };

    const morseStop = el('button', 'morse-stop-btn');
    morseStop.textContent = 'Stop';
    morseStop.onclick = () => stopMorse(dev.id);

    morseRow.appendChild(morseInput);
    morseRow.appendChild(morseWpm);
    morseRow.appendChild(morseLoop);
    morseRow.appendChild(morseSend);
    morseRow.appendChild(morseStop);
    morseSection.appendChild(morseRow);

    // Quick presets
    const morsePresets = el('div', 'morse-presets');
    const presetMsgs = ['SOS', 'HELLO', 'HI', 'LOVE'];
    presetMsgs.forEach(msg => {
      const btn = el('button', 'morse-preset-btn');
      btn.textContent = msg;
      btn.onclick = () => {
        morseInput.value = msg;
        sendMorse(dev.id, msg, parseInt(morseWpm.value), loopCb.checked);
      };
      morsePresets.appendChild(btn);
    });
    morseSection.appendChild(morsePresets);
    card.appendChild(morseSection);
  }

  return card;
}

// ---- Patterns ----

async function fetchPatterns(dev) {
  try {
    const res = await fetch('/api/devices/' + dev.id + '/patterns');
    if (!res.ok) return;
    const patterns = await res.json();
    patternCache[dev.id] = patterns;
    renderPatternGrid(dev.id, patterns, dev.status ? dev.status.mode : '');
  } catch (_) {}
}

function renderPatternGrid(deviceId, patterns, activeMode) {
  const grid = document.getElementById('patterns-' + deviceId);
  if (!grid) return;
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  patterns.forEach(pat => {
    const btn = el('button', 'pat-btn' + (activeMode === pat.id ? ' active' : ''));
    btn.textContent = pat.name;
    btn.onclick = () => setPattern(deviceId, pat.id);
    grid.appendChild(btn);
  });
}

// ---- All Devices ----

function renderAllPatterns() {
  const grid = document.getElementById('all-patterns');
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  const common = ['rainbow', 'candle', 'wave', 'sparkle', 'red', 'green', 'blue', 'white', 'off'];
  common.forEach(id => {
    const btn = el('button', 'pat-btn');
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.onclick = () => allPattern(id);
    grid.appendChild(btn);
  });
}

// ---- API Calls ----

async function setPattern(deviceId, patternId) {
  try {
    await fetch('/api/devices/' + deviceId + '/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patternId })
    });
  } catch (_) {}
}

async function setBrightness(deviceId, dir) {
  try {
    await fetch('/api/devices/' + deviceId + '/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
  } catch (_) {}
}

async function setBrightnessVal(deviceId, value) {
  try {
    await fetch('/api/devices/' + deviceId + '/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (_) {}
}

async function sendColor(deviceId, r, g, b) {
  // Send via WebSocket for real-time responsiveness
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'color_update', device: deviceId, r, g, b }));
  }
}

async function sendMorse(deviceId, text, wpm, loop) {
  try {
    await fetch('/api/devices/' + deviceId + '/morse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, wpm, loop })
    });
  } catch (_) { showToast('Failed to send morse', 'error'); }
}

async function stopMorse(deviceId) {
  try {
    await fetch('/api/devices/' + deviceId + '/morse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stop: true })
    });
  } catch (_) {}
}

async function allPattern(patternId) {
  try {
    await fetch('/api/devices/all/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patternId })
    });
  } catch (_) {}
}

async function allBrightness(dir) {
  for (const dev of devices) {
    if (dev.online) setBrightness(dev.id, dir);
  }
}

function allBrightnessVal(value) {
  for (const dev of devices) {
    if (dev.online) setBrightnessVal(dev.id, parseInt(value));
  }
}

// ---- Scenes ----

async function fetchScenes() {
  try {
    const res = await fetch('/api/scenes');
    if (!res.ok) return;
    scenes = await res.json();
    renderScenes();
  } catch (_) {}
}

function renderScenes() {
  const section = document.getElementById('scenes-section');
  const list = document.getElementById('scene-list');
  while (list.firstChild) list.removeChild(list.firstChild);

  // Show scenes section if any devices are online
  const hasOnline = devices.some(d => d.online);
  section.style.display = hasOnline ? '' : 'none';

  if (scenes.length === 0) {
    const empty = el('p', 'scene-empty');
    empty.textContent = 'No saved scenes \u2013 save current device states to create one';
    list.appendChild(empty);
    return;
  }

  scenes.forEach(scene => list.appendChild(createSceneCard(scene)));
}

function createSceneCard(scene) {
  const card = el('div', 'scene-card');

  // Info section
  const info = el('div', 'scene-info');
  const name = el('div', 'scene-name');
  name.textContent = scene.name;
  info.appendChild(name);

  const meta = el('div', 'scene-meta');
  const parts = [];
  if (scene.description) parts.push(scene.description);
  parts.push(scene.deviceCount + ' device' + (scene.deviceCount !== 1 ? 's' : ''));
  if (scene.createdAt) parts.push(formatDate(scene.createdAt));
  meta.textContent = parts.join(' \u00b7 ');
  info.appendChild(meta);

  // Schedule indicator
  if (scene.schedule) {
    const schedEl = el('div', 'scene-schedule' + (scene.schedule.enabled ? '' : ' disabled'));
    schedEl.textContent = '\u23f0 ' + cronToHuman(scene.schedule.cron) +
      (scene.schedule.enabled ? '' : ' (paused)');
    info.appendChild(schedEl);
  }

  card.appendChild(info);

  // Action buttons
  const actions = el('div', 'scene-actions');

  const schedBtn = el('button', 'scene-schedule-btn' + (scene.schedule ? ' has-schedule' : ''));
  schedBtn.textContent = scene.schedule ? '\u23f0' : '\u23f0';
  schedBtn.title = scene.schedule ? 'Edit schedule' : 'Add schedule';
  schedBtn.onclick = () => openScheduleModal(scene.name, scene.schedule);
  actions.appendChild(schedBtn);

  const activateBtn = el('button', 'scene-activate-btn');
  activateBtn.textContent = '\u25b6 Activate';
  activateBtn.onclick = () => activateScene(scene.name, activateBtn);
  actions.appendChild(activateBtn);

  const deleteBtn = el('button', 'scene-delete-btn');
  deleteBtn.textContent = '\u2715';
  deleteBtn.title = 'Delete scene';
  deleteBtn.onclick = () => deleteScene(scene.name);
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

async function activateScene(name, btn) {
  if (btn) btn.classList.add('activating');
  try {
    const res = await fetch('/api/scenes/' + encodeURIComponent(name) + '/activate', {
      method: 'POST'
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Failed to activate', 'error');
    }
    // Success toast comes via WebSocket
  } catch (err) {
    showToast('Network error', 'error');
  } finally {
    if (btn) setTimeout(() => btn.classList.remove('activating'), 500);
  }
}

async function deleteScene(name) {
  try {
    const res = await fetch('/api/scenes/' + encodeURIComponent(name), {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast('Scene "' + name + '" deleted', 'success');
      fetchScenes();
    } else {
      showToast('Failed to delete scene', 'error');
    }
  } catch (_) {
    showToast('Network error', 'error');
  }
}

// ---- Save Modal ----

function openSaveModal() {
  document.getElementById('scene-name-input').value = '';
  document.getElementById('scene-desc-input').value = '';
  document.getElementById('save-modal').classList.add('open');
  setTimeout(() => document.getElementById('scene-name-input').focus(), 100);
}

function closeSaveModal() {
  document.getElementById('save-modal').classList.remove('open');
}

async function saveScene() {
  const nameInput = document.getElementById('scene-name-input');
  const descInput = document.getElementById('scene-desc-input');
  const name = nameInput.value.trim();
  const description = descInput.value.trim();

  if (!name) {
    nameInput.style.borderColor = '#ff4455';
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showToast('Name: letters, numbers, dashes, underscores only', 'error');
    return;
  }

  try {
    const res = await fetch('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    const data = await res.json();
    if (res.ok) {
      closeSaveModal();
      showToast('Scene "' + name + '" saved', 'success');
      fetchScenes();
    } else {
      showToast(data.error || 'Failed to save', 'error');
    }
  } catch (_) {
    showToast('Network error', 'error');
  }
}

// Close modal on overlay click or Escape
document.getElementById('save-modal').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeSaveModal();
});
document.getElementById('schedule-modal').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeScheduleModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSaveModal(); closeScheduleModal(); }
  if (e.key === 'Enter') {
    if (document.getElementById('save-modal').classList.contains('open')) saveScene();
    if (document.getElementById('schedule-modal').classList.contains('open')) saveSchedule();
  }
});

// ---- Schedule Modal ----

let scheduleTarget = null; // Scene name being scheduled

function openScheduleModal(sceneName, existingSchedule) {
  scheduleTarget = sceneName;
  document.getElementById('schedule-scene-name').textContent = 'Scene: ' + sceneName;
  const cronInput = document.getElementById('schedule-cron-input');
  const descInput = document.getElementById('schedule-desc-input');

  if (existingSchedule) {
    cronInput.value = existingSchedule.cron;
    descInput.value = existingSchedule.description || '';
  } else {
    cronInput.value = '';
    descInput.value = '';
  }

  document.getElementById('schedule-modal').classList.add('open');
  setTimeout(() => cronInput.focus(), 100);
}

function closeScheduleModal() {
  document.getElementById('schedule-modal').classList.remove('open');
  scheduleTarget = null;
}

function setCronPreset(cron) {
  document.getElementById('schedule-cron-input').value = cron;
}

async function saveSchedule() {
  if (!scheduleTarget) return;
  const cronExpr = document.getElementById('schedule-cron-input').value.trim();
  const description = document.getElementById('schedule-desc-input').value.trim();

  if (!cronExpr) {
    // If empty, remove existing schedule
    try {
      await fetch('/api/scenes/' + encodeURIComponent(scheduleTarget) + '/schedule', {
        method: 'DELETE'
      });
      showToast('Schedule removed', 'success');
      closeScheduleModal();
      fetchScenes();
    } catch (_) {
      showToast('Failed to remove schedule', 'error');
    }
    return;
  }

  try {
    const res = await fetch('/api/scenes/' + encodeURIComponent(scheduleTarget) + '/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: cronExpr, description })
    });
    const data = await res.json();
    if (res.ok) {
      closeScheduleModal();
      showToast('Schedule set: ' + cronToHuman(cronExpr), 'success');
      fetchScenes();
    } else {
      showToast(data.error || 'Invalid schedule', 'error');
    }
  } catch (_) {
    showToast('Network error', 'error');
  }
}

// Convert cron expression to human-readable string
function cronToHuman(expr) {
  if (!expr) return '';
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  let time = '';
  if (hour !== '*' && min !== '*') {
    const h = parseInt(hour);
    const m = parseInt(min);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    time = h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
  }

  let days = '';
  if (dow === '*' && dom === '*') {
    days = 'daily';
  } else if (dow === '1-5') {
    days = 'weekdays';
  } else if (dow === '0,6') {
    days = 'weekends';
  } else if (dow !== '*') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days = dow.split(',').map(d => dayNames[parseInt(d)] || d).join(', ');
  }

  if (min.startsWith('*/')) {
    return 'every ' + min.substring(2) + ' min';
  }
  if (hour.startsWith('*/')) {
    return 'every ' + hour.substring(2) + ' hours';
  }

  return [time, days].filter(Boolean).join(' ');
}

// ---- Toast Notifications ----

let toastTimer = null;
function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (type || '') + ' visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); }, 2500);
}

// ---- Helpers ----

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function addInfoItem(parent, label, value) {
  const item = el('div', 'info-item');
  const lbl = el('span', 'info-label');
  lbl.textContent = label;
  const val = el('span', 'info-value');
  val.textContent = value;
  item.appendChild(lbl);
  item.appendChild(val);
  parent.appendChild(item);
}

function formatUptime(secs) {
  if (!secs && secs !== 0) return '?';
  if (secs > 86400) return Math.floor(secs / 86400) + 'd ' + Math.floor((secs % 86400) / 3600) + 'h';
  if (secs > 3600) return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
  if (secs > 60) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  return secs + 's';
}

function formatBytes(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  } catch (_) { return ''; }
}

// ---- Start ----
connect();
