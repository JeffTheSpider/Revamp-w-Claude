// ============================================================
// Revamp Hub - PWA Client
// ============================================================
// WebSocket client that renders device cards with live status,
// pattern selection, brightness slider, and color picker.
// Uses safe DOM methods throughout (no innerHTML).
// ============================================================

let ws = null;
let devices = [];
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

// ---- Start ----
connect();
