// ============================================================
// Revamp Hub - PWA Client
// ============================================================
// WebSocket client that renders device cards with live status,
// pattern selection, and brightness control.
// ============================================================

let ws = null;
let devices = [];
let reconnectTimer = null;

// Connect to Hub WebSocket
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => {
    document.getElementById('connection-status').textContent = 'Connected';
    if (reconnectTimer) clearInterval(reconnectTimer);
    reconnectTimer = null;
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    document.getElementById('connection-status').textContent = 'Disconnected - reconnecting...';
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connect, 3000);
    }
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
      // Refresh full list
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'get_devices' }));
      }
      break;
  }
}

function updateDevice(id, data) {
  const idx = devices.findIndex(d => d.id === id);
  if (idx >= 0) {
    devices[idx] = data;
    renderDevices();
  }
}

// Render all device cards
function renderDevices() {
  const container = document.getElementById('devices');
  // Clear existing content safely
  while (container.firstChild) container.removeChild(container.firstChild);

  devices.forEach(dev => {
    container.appendChild(createDeviceCard(dev));
  });

  // Update "All Devices" pattern grid with patterns from first online device
  const online = devices.find(d => d.online && d.status);
  if (online && online.status) {
    renderAllPatterns(online);
  }
}

// Create a device card DOM element
function createDeviceCard(dev) {
  const card = document.createElement('div');
  card.className = 'device-card ' + (dev.online ? 'online' : 'offline');

  // Header
  const header = document.createElement('div');
  header.className = 'device-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'device-name';
  const dot = document.createElement('span');
  dot.className = 'status-dot ' + (dev.online ? 'on' : 'off');
  nameSpan.appendChild(dot);
  nameSpan.appendChild(document.createTextNode(dev.name));
  header.appendChild(nameSpan);

  if (dev.online && dev.status) {
    const modeSpan = document.createElement('span');
    modeSpan.style.color = '#00d4ff';
    modeSpan.style.fontSize = '13px';
    modeSpan.textContent = dev.status.modeName || dev.status.mode;
    header.appendChild(modeSpan);
  }

  card.appendChild(header);

  if (!dev.online) {
    const offMsg = document.createElement('p');
    offMsg.style.color = '#ff4444';
    offMsg.style.fontSize = '13px';
    offMsg.textContent = 'Device offline';
    card.appendChild(offMsg);
    return card;
  }

  const s = dev.status;
  if (!s) return card;

  // Info grid
  const info = document.createElement('div');
  info.className = 'device-info';
  const infoItems = [
    ['IP', s.ip],
    ['Version', 'v' + s.version],
    ['Heap', s.freeHeap + ' B'],
    ['WiFi', s.rssi + ' dBm'],
    ['Uptime', formatUptime(s.uptime)],
    ['NTP', s.ntpValid ? 'Synced' : 'Pending']
  ];
  infoItems.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'info-item';
    const lbl = document.createElement('span');
    lbl.className = 'info-label';
    lbl.textContent = label + ': ';
    const val = document.createElement('span');
    val.className = 'info-value';
    val.textContent = value;
    item.appendChild(lbl);
    item.appendChild(val);
    info.appendChild(item);
  });
  card.appendChild(info);

  // Pattern grid (fetch async)
  const patGrid = document.createElement('div');
  patGrid.className = 'pattern-grid';
  patGrid.id = 'patterns-' + dev.id;
  card.appendChild(patGrid);
  fetchPatterns(dev);

  // Brightness control
  const brRow = document.createElement('div');
  brRow.className = 'brightness-row';

  const brDown = document.createElement('button');
  brDown.className = 'br-btn';
  brDown.textContent = '-';
  brDown.onclick = () => setBrightness(dev.id, 'down');

  const brVal = document.createElement('span');
  brVal.className = 'br-val';
  brVal.textContent = s.brightness;

  const brUp = document.createElement('button');
  brUp.className = 'br-btn';
  brUp.textContent = '+';
  brUp.onclick = () => setBrightness(dev.id, 'up');

  brRow.appendChild(brDown);
  brRow.appendChild(brVal);
  brRow.appendChild(brUp);
  card.appendChild(brRow);

  return card;
}

// Fetch and render patterns for a device
async function fetchPatterns(dev) {
  try {
    const res = await fetch('/api/devices/' + dev.id + '/patterns');
    const patterns = await res.json();
    const grid = document.getElementById('patterns-' + dev.id);
    if (!grid) return;

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    patterns.forEach(pat => {
      const btn = document.createElement('button');
      btn.className = 'pat-btn' + (dev.status && dev.status.mode === pat.id ? ' active' : '');
      btn.textContent = pat.name;
      btn.onclick = () => setPattern(dev.id, pat.id);
      grid.appendChild(btn);
    });
  } catch {
    // Device may be slow to respond
  }
}

// Set pattern on a device
async function setPattern(deviceId, patternId) {
  try {
    await fetch('/api/devices/' + deviceId + '/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patternId })
    });
  } catch (e) {
    console.error('Set pattern failed:', e);
  }
}

// Set brightness on a device
async function setBrightness(deviceId, dir) {
  try {
    await fetch('/api/devices/' + deviceId + '/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
  } catch (e) {
    console.error('Set brightness failed:', e);
  }
}

// All-devices controls
function renderAllPatterns(dev) {
  const grid = document.getElementById('all-patterns');
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  // Common patterns shared across devices
  const common = ['rainbow', 'candle', 'wave', 'sparkle', 'red', 'green', 'blue', 'white', 'off'];
  common.forEach(id => {
    const btn = document.createElement('button');
    btn.className = 'pat-btn';
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.onclick = () => allPattern(id);
    grid.appendChild(btn);
  });
}

async function allPattern(patternId) {
  try {
    await fetch('/api/devices/all/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patternId })
    });
  } catch (e) {
    console.error('All pattern failed:', e);
  }
}

async function allBrightness(dir) {
  const val = dir === 'up' ? 100 : 30; // Placeholder
  try {
    await fetch('/api/devices/all/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
  } catch (e) {
    console.error('All brightness failed:', e);
  }
}

function formatUptime(secs) {
  if (secs > 86400) return Math.floor(secs / 86400) + 'd ' + Math.floor((secs % 86400) / 3600) + 'h';
  if (secs > 3600) return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
  if (secs > 60) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  return secs + 's';
}

// Start
connect();
