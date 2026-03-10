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
let activeSlider = null; // deviceId of slider being dragged (skip updates)
let renderPending = false;

// Update slider filled track visual
function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--fill-pct', pct + '%');
}

// Batch multiple updates into one render per frame
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderDevices();
  });
}

// ---- WebSocket ----

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Connected';
    el.className = 'connected';
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  };

  ws.onclose = () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Disconnected \u2013 reconnecting...';
    el.className = 'disconnected';
    // Use setTimeout (not setInterval) to prevent duplicate connections
    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'devices':
      devices = msg.data;
      scheduleRender();
      fetchScenes(); // Refresh scenes when device list updates
      break;
    case 'device_status':
      updateDevice(msg.id, msg.data);
      break;
    case 'device_online':
      // Clear pattern cache so we re-fetch (patterns may have changed)
      if (msg.id) delete patternCache[msg.id];
      allPatternsRendered = false; // Refresh all-devices grid too
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'get_devices' }));
      }
      break;
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
    case 'audio_data':
      updateAudioUI(msg);
      break;
    case 'audio_status':
      audioActive = !!(msg.data && msg.data.active);
      updateAudioToggle();
      break;
    case 'circadian_status':
      updateCircadianUI(msg.data);
      break;
    case 'circadian_kelvin':
      updateCircadianKelvin(msg.kelvin);
      break;
    case 'sunrise_triggered':
      showToast('Sunrise alarm triggered! (' + msg.alarm + ')', 'info');
      break;
    case 'notification_status':
      updateNotificationUI(msg.data);
      break;
    case 'notification_sent':
      addNotificationToHistory(msg.data);
      showToast('Notification: ' + (msg.data.title || 'Sent'), 'info');
      break;
    case 'weather_update':
      updateWeatherDisplay(msg.data);
      break;
    case 'animation_status':
      updateAnimationUI(msg.data);
      break;
    case 'animation_playing':
      showToast('Playing: ' + (msg.data.name || 'Animation'), 'info');
      break;
    case 'groups':
      updateGroupsUI(msg.data);
      break;
    case 'group_saved':
      showToast('Group "' + msg.name + '" saved', 'info');
      break;
    case 'group_deleted':
      showToast('Group "' + msg.name + '" deleted', 'info');
      break;
    case 'error':
      showToast(msg.message || 'An error occurred', 'error');
      break;
  }
}

function updateDevice(id, data) {
  const idx = devices.findIndex(d => d.id === id);
  if (idx >= 0) { devices[idx] = data; scheduleRender(); }
}

// ---- Rendering ----

function renderDevices() {
  const container = document.getElementById('devices');

  if (devices.length === 0) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const p = document.createElement('p');
    p.style.cssText = 'text-align:center;color:var(--text-dim);font-size:13px';
    p.textContent = 'No devices found';
    container.appendChild(p);
    document.getElementById('all-section').style.display = 'none';
    return;
  }

  // Remove skeleton cards and placeholders
  container.querySelectorAll('.skeleton-card, p').forEach(el => el.remove());

  // Build set of current device IDs
  const currentIds = new Set(devices.map(d => d.id));

  // Remove cards for devices that no longer exist
  container.querySelectorAll('.device-card[data-device-id]').forEach(card => {
    if (!currentIds.has(card.dataset.deviceId)) container.removeChild(card);
  });

  // Update or create cards for each device
  devices.forEach((dev, idx) => {
    const existing = container.querySelector('[data-device-id="' + dev.id + '"]');
    if (existing) {
      const wasOnline = existing.classList.contains('online');
      if (wasOnline !== dev.online) {
        // Online/offline status changed - full card rebuild needed
        container.replaceChild(createDeviceCard(dev), existing);
      } else if (dev.online) {
        // Same status, update values in-place (preserves inputs)
        updateDeviceCard(existing, dev);
      }
    } else {
      // New device - create card with stagger animation
      const newCard = createDeviceCard(dev);
      newCard.style.setProperty('--card-index', idx);
      container.appendChild(newCard);
    }
  });

  // Show "All Devices" section if any online
  const onlineCount = devices.filter(d => d.online).length;
  document.getElementById('all-section').style.display = onlineCount > 0 ? '' : 'none';
  const countEl = document.getElementById('all-device-count');
  if (countEl) countEl.textContent = '(' + onlineCount + ' online)';
  if (onlineCount > 0) renderAllPatterns();
  updateAudioVisibility();
}

// Update an existing device card in-place without destroying user inputs
function updateDeviceCard(card, dev) {
  const s = dev.status;
  if (!s) return;

  // Update mode badge
  const mode = card.querySelector('.device-mode');
  if (mode) mode.textContent = s.modeName || s.mode;

  // Update info values by data attribute
  updateInfoValue(card, 'IP', s.ip);
  updateInfoValue(card, 'Heap', formatBytes(s.freeHeap));
  updateInfoValue(card, 'WiFi', s.rssi + ' dBm');
  updateInfoValue(card, 'Uptime', formatUptime(s.uptime));
  updateInfoValue(card, 'Version', 'v' + s.version);
  updateInfoValue(card, 'NTP', s.ntpValid ? '\u2713 Synced' : 'Pending');

  // Update brightness display (skip if user is dragging this slider)
  if (activeSlider !== dev.id) {
    const brSlider = card.querySelector('.br-slider');
    const brVal = card.querySelector('.br-val');
    if (brSlider && brVal) {
      brSlider.value = String(s.brightness);
      brVal.textContent = String(s.brightness);
      updateSliderFill(brSlider);
    }
  }

  // Update pattern active highlight (no re-fetch)
  if (patternCache[dev.id]) {
    const buttons = card.querySelectorAll('.pat-btn');
    const patterns = patternCache[dev.id];
    buttons.forEach((btn, i) => {
      if (i < patterns.length) {
        const isActive = s.mode === patterns[i].id;
        btn.className = 'pat-btn' + (isActive ? ' active' : '');
      }
    });
  }

  // Morse input, WPM dropdown, loop checkbox, color picker are UNTOUCHED
}

function updateInfoValue(card, label, value) {
  const el = card.querySelector('.info-value[data-info-key="' + label + '"]');
  if (el && el.textContent !== value) el.textContent = value;
}

function createDeviceCard(dev) {
  const card = el('div', 'device-card ' + (dev.online ? 'online' : 'offline'));
  card.dataset.deviceId = dev.id;

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

    const restartBtn = el('button', 'restart-btn');
    restartBtn.textContent = '\u21bb';
    restartBtn.title = 'Restart device';
    restartBtn.onclick = (e) => {
      e.stopPropagation();
      restartDevice(dev.id, restartBtn);
    };
    header.appendChild(restartBtn);
  }
  card.appendChild(header);

  if (!dev.online) {
    const msg = el('p', 'offline-msg');
    msg.textContent = dev.lastSeen
      ? 'Device offline \u2022 last seen ' + formatDate(dev.lastSeen)
      : 'Device offline \u2022 never connected';
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
  // Track when user is actively dragging to prevent server updates overwriting
  brSlider.addEventListener('mousedown', () => { activeSlider = dev.id; });
  brSlider.addEventListener('touchstart', () => { activeSlider = dev.id; });
  brSlider.addEventListener('mouseup', () => { activeSlider = null; });
  brSlider.addEventListener('touchend', () => { activeSlider = null; });
  brSlider.oninput = () => {
    activeSlider = dev.id; // Also mark active during drag
    brVal.textContent = brSlider.value;
    updateSliderFill(brSlider);
    clearTimeout(sliderTimeout);
    sliderTimeout = setTimeout(() => {
      setBrightnessVal(dev.id, parseInt(brSlider.value));
      activeSlider = null;
    }, 150);
  };
  // Set initial fill
  requestAnimationFrame(() => updateSliderFill(brSlider));

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
  // Use cached patterns if available (avoids re-fetching on every render)
  if (patternCache[dev.id]) {
    renderPatternGrid(dev.id, patternCache[dev.id], dev.status ? dev.status.mode : '');
    return;
  }
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

let allPatternsRendered = false;
function renderAllPatterns() {
  if (allPatternsRendered) return;
  allPatternsRendered = true;

  const grid = document.getElementById('all-patterns');
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  // Compute common patterns from cached pattern lists of online devices
  const onlineIds = devices.filter(d => d.online).map(d => d.id);
  const patternSets = onlineIds.map(id => patternCache[id]).filter(Boolean);

  let common;
  if (patternSets.length > 0) {
    // Find intersection of all pattern ID sets
    const first = new Set(patternSets[0].map(p => p.id));
    for (let i = 1; i < patternSets.length; i++) {
      const ids = new Set(patternSets[i].map(p => p.id));
      for (const id of first) { if (!ids.has(id)) first.delete(id); }
    }
    // Use first device's order, filter to common
    common = patternSets[0].filter(p => first.has(p.id));
  } else {
    // Fallback: hardcoded common patterns
    const fallback = ['rainbow', 'candle', 'wave', 'sparkle', 'wedge', 'red', 'green', 'blue', 'white', 'off'];
    common = fallback.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
  }

  common.forEach(pat => {
    const btn = el('button', 'pat-btn');
    btn.textContent = pat.name;
    btn.onclick = () => allPattern(pat.id);
    grid.appendChild(btn);
  });

  // Populate "All" color presets
  const presets = document.getElementById('all-color-presets');
  if (presets && !presets.hasChildNodes()) {
    const colors = ['#ff0000', '#ff6600', '#ffcc00', '#00ff00', '#00ffcc', '#0088ff', '#8800ff', '#ff00aa', '#ffffff'];
    colors.forEach(color => {
      const swatch = document.createElement('button');
      swatch.className = 'color-preset';
      swatch.style.background = color;
      swatch.onclick = () => {
        document.getElementById('all-color').value = color;
        allColor(color);
      };
      presets.appendChild(swatch);
    });
  }
}

// ---- API Calls ----

async function setPattern(deviceId, patternId) {
  // Optimistic UI: immediately highlight the clicked pattern
  const card = document.querySelector('[data-device-id="' + deviceId + '"]');
  if (card) {
    card.querySelectorAll('.pat-btn').forEach(btn => btn.classList.remove('active'));
    const patterns = patternCache[deviceId] || [];
    const idx = patterns.findIndex(p => p.id === patternId);
    if (idx >= 0) {
      const btns = card.querySelectorAll('.pat-btn');
      if (btns[idx]) btns[idx].classList.add('active');
    }
    const mode = card.querySelector('.device-mode');
    if (mode) {
      const pat = patterns.find(p => p.id === patternId);
      if (pat) mode.textContent = pat.name;
    }
  }
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

async function restartDevice(deviceId, btn) {
  if (!confirm('Restart ' + deviceId + '?')) return;
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    await fetch('/api/devices/' + deviceId + '/restart', { method: 'POST' });
    showToast('Restarting ' + deviceId + '...', 'success');
  } catch (_) {
    showToast('Failed to restart', 'error');
  }
  if (btn) setTimeout(() => { btn.textContent = '\u21bb'; btn.disabled = false; }, 3000);
}

async function allPattern(patternId) {
  try {
    const res = await fetch('/api/devices/all/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patternId })
    });
    if (!res.ok) showToast('Pattern sync failed', 'error');
  } catch (_) { showToast('Pattern sync failed', 'error'); }
}

async function allBrightness(dir) {
  try {
    const res = await fetch('/api/devices/all/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
    if (!res.ok) showToast('Brightness sync failed', 'error');
  } catch (_) { showToast('Brightness sync failed', 'error'); }
}

let allBrSliderTimeout = null;
function allBrightnessVal(value) {
  clearTimeout(allBrSliderTimeout);
  allBrSliderTimeout = setTimeout(async () => {
    try {
      const res = await fetch('/api/devices/all/brightness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parseInt(value) })
      });
      if (!res.ok) showToast('Brightness sync failed', 'error');
    } catch (_) { showToast('Brightness sync failed', 'error'); }
  }, 150);
}

let allColorTimeout = null;
function allColor(hex) {
  clearTimeout(allColorTimeout);
  allColorTimeout = setTimeout(async () => {
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    try {
      const res = await fetch('/api/devices/all/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r, g, b })
      });
      if (!res.ok) showToast('Color sync failed', 'error');
    } catch (_) { showToast('Color sync failed', 'error'); }
  }, 80);
}

// Convert Kelvin color temperature to RGB (simplified Tanner Helland algorithm)
function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = Math.min(255, Math.max(0, 99.4708 * Math.log(temp) - 161.1196));
    b = temp <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177 * Math.log(temp - 10) - 305.0448));
  } else {
    r = Math.min(255, Math.max(0, 329.6987 * Math.pow(temp - 60, -0.1332)));
    g = Math.min(255, Math.max(0, 288.1221 * Math.pow(temp - 60, -0.0755)));
    b = 255;
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

let colorTempTimeout = null;
function allColorTemp(kelvin) {
  clearTimeout(colorTempTimeout);
  colorTempTimeout = setTimeout(() => {
    const { r, g, b } = kelvinToRgb(parseInt(kelvin));
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    document.getElementById('all-color').value = hex;
    allColor(hex);
  }, 80);
}

async function allRestart() {
  const online = devices.filter(d => d.online);
  if (online.length === 0) return;
  if (!confirm('Restart all ' + online.length + ' device(s)?')) return;
  try {
    const res = await fetch('/api/devices/all/restart', { method: 'POST' });
    if (res.ok) {
      showToast('Restarting ' + online.length + ' device(s)...', 'success');
    } else {
      showToast('Restart failed', 'error');
    }
  } catch (_) { showToast('Restart failed', 'error'); }
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

  // Basic cron validation: must be 5 space-separated fields
  if (cronExpr && cronExpr.split(' ').length !== 5) {
    showToast('Cron must have 5 fields: min hour day month weekday', 'error');
    return;
  }

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
  val.dataset.infoKey = label; // For in-place updates
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

// ---- Audio Reactive ----

let audioActive = false;
let spectrumCtx = null;
let beatDotTimer = null;

function toggleAudio() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: audioActive ? 'audio_stop' : 'audio_start' }));
}

function setAudioSensitivity(value) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'audio_sensitivity', value }));
}

function updateAudioToggle() {
  const btn = document.getElementById('audio-toggle');
  const ui = document.getElementById('audio-active-ui');
  if (btn) {
    btn.textContent = audioActive ? 'Stop Listening' : 'Start Listening';
    btn.className = 'audio-toggle-btn' + (audioActive ? ' active' : '');
  }
  if (ui) ui.style.display = audioActive ? '' : 'none';
}

function updateAudioUI(data) {
  const bassBar = document.getElementById('bass-bar');
  const midBar = document.getElementById('mid-bar');
  const trebleBar = document.getElementById('treble-bar');
  if (bassBar) bassBar.style.width = (data.bass * 100) + '%';
  if (midBar) midBar.style.width = (data.mid * 100) + '%';
  if (trebleBar) trebleBar.style.width = (data.treble * 100) + '%';

  // Beat dot
  if (data.beat) {
    const dot = document.getElementById('beat-dot');
    if (dot) {
      dot.classList.add('active');
      clearTimeout(beatDotTimer);
      beatDotTimer = setTimeout(() => dot.classList.remove('active'), 120);
    }
  }

  // Spectrum canvas
  if (data.spectrum) drawSpectrum(data.spectrum);
}

function drawSpectrum(bins) {
  const canvas = document.getElementById('spectrum-canvas');
  if (!canvas) return;
  if (!spectrumCtx) spectrumCtx = canvas.getContext('2d');
  const ctx = spectrumCtx;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const barW = (w / bins.length) - 2;
  const colors = [
    '#f38ba8', '#f38ba8',   // red (bass)
    '#fab387', '#fab387',   // peach
    '#f9e2af', '#f9e2af',   // yellow
    '#a6e3a1', '#a6e3a1',   // green (mid)
    '#94e2d5', '#94e2d5',   // teal
    '#89b4fa', '#89b4fa',   // blue
    '#b4befe', '#b4befe',   // lavender (treble)
    '#cba6f7', '#cba6f7'    // mauve
  ];

  for (let i = 0; i < bins.length; i++) {
    const barH = Math.max(bins[i] * h * 0.9, 1);
    const x = i * (barW + 2) + 1;
    ctx.fillStyle = colors[i] || '#cba6f7';
    ctx.beginPath();
    ctx.roundRect(x, h - barH, barW, barH, 2);
    ctx.fill();
  }
}

// Show audio section when any device is online
function updateAudioVisibility() {
  const section = document.getElementById('audio-section');
  if (section) {
    const online = devices.some(d => d.online);
    section.style.display = online ? '' : 'none';
  }
  // Show ambient section when any device has ambient capability
  const ambientSection = document.getElementById('ambient-section');
  if (ambientSection) {
    const hasAmbient = devices.some(d => d.online && d.capabilities && d.capabilities.includes('ambient'));
    ambientSection.style.display = hasAmbient ? '' : 'none';
  }
  // Show notifications section when any device has notify capability
  const notifySection = document.getElementById('notify-section');
  if (notifySection) {
    const hasNotify = devices.some(d => d.online && d.capabilities && d.capabilities.includes('notify'));
    notifySection.style.display = hasNotify ? '' : 'none';
  }
  // Show animation section when any device has animations capability
  const animSection = document.getElementById('animation-section');
  if (animSection) {
    const hasAnim = devices.some(d => d.online && d.capabilities && d.capabilities.includes('animations'));
    animSection.style.display = hasAnim ? '' : 'none';
  }
  // Show tools section
  updateToolsVisibility();
}

// ---- Circadian / Ambient ----

let circadianActive = false;

function toggleCircadian() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: circadianActive ? 'circadian_stop' : 'circadian_start' }));
}

function updateCircadianUI(data) {
  if (!data) return;
  circadianActive = data.enabled;
  const btn = document.getElementById('circadian-toggle');
  const activeUI = document.getElementById('circadian-active-ui');
  if (btn) {
    btn.textContent = circadianActive ? 'Stop Circadian' : 'Start Circadian';
    btn.classList.toggle('active', circadianActive);
  }
  if (activeUI) activeUI.style.display = circadianActive ? '' : 'none';
  if (data.currentKelvin) updateCircadianKelvin(data.currentKelvin);

  // Show alarms
  const alarmsEl = document.getElementById('sunrise-alarms');
  if (alarmsEl && data.alarms && data.alarms.length > 0) {
    alarmsEl.textContent = 'Active alarms: ' + data.alarms.map(a => a.time).join(', ');
  } else if (alarmsEl) {
    alarmsEl.textContent = '';
  }
}

function updateCircadianKelvin(kelvin) {
  const el = document.getElementById('circadian-kelvin');
  if (el) el.textContent = kelvin + 'K';
}

function setSunriseAlarm() {
  const timeInput = document.getElementById('sunrise-time');
  if (!timeInput || !ws || ws.readyState !== 1) return;
  const [h, m] = timeInput.value.split(':').map(Number);
  ws.send(JSON.stringify({ type: 'sunrise_alarm_set', hour: h, minute: m }));
  showToast('Sunrise alarm set for ' + timeInput.value, 'info');
}

function removeSunriseAlarm() {
  const timeInput = document.getElementById('sunrise-time');
  if (!timeInput || !ws || ws.readyState !== 1) return;
  const [h, m] = timeInput.value.split(':').map(Number);
  ws.send(JSON.stringify({ type: 'sunrise_alarm_remove', hour: h, minute: m }));
  showToast('Sunrise alarm removed', 'info');
}

function setAllPattern(patternId) {
  if (!ws || ws.readyState !== 1) return;
  // Send to all online devices via Hub proxy
  fetch('/api/devices/all/pattern', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: patternId })
  }).then(r => r.json()).then(() => {
    showToast('All devices: ' + patternId, 'info');
  }).catch(() => {
    showToast('Failed to set pattern', 'error');
  });
}

// ---- Notifications ----

let notifyApiKey = '';

function updateNotificationUI(data) {
  if (!data) return;
  notifyApiKey = data.apiKey || '';
  // Update webhook URL display
  const urlEl = document.getElementById('webhook-url');
  if (urlEl) {
    const host = window.location.hostname + ':' + window.location.port;
    urlEl.textContent = 'POST http://' + host + '/api/notify?key=' + notifyApiKey;
  }
  // Update weather config inputs
  if (data.weather) {
    const cityInput = document.getElementById('weather-city');
    const keyInput = document.getElementById('weather-key');
    if (cityInput && data.weather.city) cityInput.value = data.weather.city;
    if (keyInput && data.weather.hasApiKey) keyInput.placeholder = 'Key saved (hidden)';
    if (data.weather.data) updateWeatherDisplay(data.weather.data);
  }
  // Update history
  if (data.historyCount > 0) {
    fetch('/api/notifications/history?limit=10')
      .then(r => r.json())
      .then(history => renderNotificationHistory(history))
      .catch(() => {});
  }
}

function sendTestNotification() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'notification_test' }));
}

function sendQuickNotify(profileName) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'notification_send', config: { profile: profileName } }));
}

function copyWebhookUrl() {
  const urlEl = document.getElementById('webhook-url');
  if (!urlEl) return;
  navigator.clipboard.writeText(urlEl.textContent).then(() => {
    showToast('Webhook URL copied', 'info');
  }).catch(() => {
    showToast('Copy failed', 'error');
  });
}

function saveWeatherConfig() {
  const city = document.getElementById('weather-city').value.trim();
  const apiKey = document.getElementById('weather-key').value.trim();
  if (!city) { showToast('Enter a city name', 'error'); return; }
  const config = { weather: { city } };
  if (apiKey) config.weather.apiKey = apiKey;
  fetch('/api/notifications/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  }).then(r => r.json()).then(data => {
    showToast('Weather config saved for ' + city, 'info');
    // Start weather polling if API key is configured
    if (apiKey || document.getElementById('weather-key').placeholder.includes('saved')) {
      fetch('/api/notifications/weather/start', { method: 'POST' })
        .then(r => r.json())
        .then(r => { if (r.ok) showToast('Weather polling started', 'info'); })
        .catch(() => {});
    }
  }).catch(() => showToast('Failed to save weather config', 'error'));
}

function updateWeatherDisplay(data) {
  if (!data) return;
  const container = document.getElementById('weather-display');
  const tempEl = document.getElementById('weather-temp');
  const condEl = document.getElementById('weather-cond');
  const detailEl = document.getElementById('weather-detail');
  if (container) container.style.display = '';
  if (tempEl) tempEl.textContent = data.temp + '\u00B0C';
  if (condEl) condEl.textContent = data.condition + ' - ' + data.city;
  if (detailEl) detailEl.textContent = data.description + ' | ' +
    data.humidity + '% humidity | wind ' + data.wind + ' m/s';
}

function triggerWeatherNotify() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'weather_notify' }));
}

function addNotificationToHistory(entry) {
  fetch('/api/notifications/history?limit=10')
    .then(r => r.json())
    .then(history => renderNotificationHistory(history))
    .catch(() => {});
}

function renderNotificationHistory(history) {
  const container = document.getElementById('notify-history');
  if (!container || !Array.isArray(history) || history.length === 0) return;
  // Clear using safe DOM method
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const entry of history) {
    const item = document.createElement('div');
    item.className = 'notify-history-item';

    const dot = document.createElement('div');
    dot.className = 'notify-color-dot';
    const c = entry.color || { r: 200, g: 200, b: 200 };
    dot.style.background = 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';

    const title = document.createElement('span');
    title.className = 'notify-history-title';
    title.textContent = entry.title || 'Notification';

    const time = document.createElement('span');
    time.className = 'notify-history-time';
    const d = new Date(entry.timestamp);
    time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    item.appendChild(dot);
    item.appendChild(title);
    item.appendChild(time);
    container.appendChild(item);
  }
}

// ---- Animation Designer ----

// Temporary keyframes for the editor
let editorKeyframes = [];
let animationData = { animations: [], playing: {} };

function updateAnimationUI(data) {
  if (!data) return;
  animationData = data;

  // Render preset buttons
  const presetsEl = document.getElementById('anim-presets');
  if (presetsEl) {
    while (presetsEl.firstChild) presetsEl.removeChild(presetsEl.firstChild);
    const anims = data.animations || [];
    for (const anim of anims) {
      const btn = document.createElement('button');
      btn.textContent = anim.name;
      const isPlaying = Object.values(data.playing || {}).includes(anim.name);
      if (isPlaying) btn.classList.add('playing');
      btn.addEventListener('click', () => animPlayPreset(anim.name));
      presetsEl.appendChild(btn);
    }
  }

  // Render saved animation list
  renderSavedAnimations(data.animations || []);
}

function renderSavedAnimations(anims) {
  const container = document.getElementById('anim-saved-list');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  if (anims.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-sub); font-size:12px; padding:8px 0';
    empty.textContent = 'No saved animations';
    container.appendChild(empty);
    return;
  }

  for (const anim of anims) {
    const item = document.createElement('div');
    item.className = 'anim-saved-item';

    const name = document.createElement('span');
    name.className = 'anim-saved-name';
    name.textContent = anim.name;

    const info = document.createElement('span');
    info.className = 'anim-saved-info';
    info.textContent = anim.keyframeCount + ' kf, ' + (anim.duration / 1000).toFixed(1) + 's';

    const playBtn = document.createElement('button');
    playBtn.className = 'anim-saved-play';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => animPlayPreset(anim.name));

    const delBtn = document.createElement('button');
    delBtn.className = 'anim-saved-del';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', () => animDeleteSaved(anim.name));

    item.appendChild(name);
    item.appendChild(info);
    item.appendChild(playBtn);
    item.appendChild(delBtn);
    container.appendChild(item);
  }
}

function animPlayPreset(name) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'animation_play', name: name, loop: true }));
  showToast('Playing: ' + name, 'info');
}

function animStopAll() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'animation_stop', revertMode: 'candle' }));
  showToast('Stopping animations', 'info');
}

function animAddKeyframe() {
  const timeInput = document.getElementById('new-kf-time');
  const colorInput = document.getElementById('new-kf-color');
  if (!timeInput || !colorInput) return;

  const timeMs = parseInt(timeInput.value) || 0;
  const hex = colorInput.value;
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);

  editorKeyframes.push({ time: timeMs, leds: 'solid', r, g, b });
  editorKeyframes.sort((a, b) => a.time - b.time);

  // Auto-advance time for next keyframe
  timeInput.value = timeMs + 1000;

  renderEditorKeyframes();
}

function animRemoveKeyframe(idx) {
  editorKeyframes.splice(idx, 1);
  renderEditorKeyframes();
}

function renderEditorKeyframes() {
  const container = document.getElementById('anim-kf-list');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  for (let i = 0; i < editorKeyframes.length; i++) {
    const kf = editorKeyframes[i];
    const row = document.createElement('div');
    row.className = 'anim-kf-row';

    const label = document.createElement('span');
    label.className = 'anim-kf-label';
    label.textContent = 'KF ' + (i + 1);

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'color:var(--text-main); font-size:12px; min-width:50px';
    timeSpan.textContent = kf.time + 'ms';

    const colorDot = document.createElement('span');
    colorDot.style.cssText = 'width:20px; height:20px; border-radius:4px; display:inline-block; background:rgb(' + kf.r + ',' + kf.g + ',' + kf.b + ')';

    const rgb = document.createElement('span');
    rgb.style.cssText = 'color:var(--text-sub); font-size:11px';
    rgb.textContent = kf.r + ',' + kf.g + ',' + kf.b;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'anim-kf-remove';
    removeBtn.textContent = 'X';
    const idx = i;
    removeBtn.addEventListener('click', () => animRemoveKeyframe(idx));

    row.appendChild(label);
    row.appendChild(timeSpan);
    row.appendChild(colorDot);
    row.appendChild(rgb);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

function animSaveNew() {
  const nameInput = document.getElementById('anim-save-name');
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) { showToast('Enter an animation name', 'error'); return; }
  if (editorKeyframes.length < 2) { showToast('Need at least 2 keyframes', 'error'); return; }

  const duration = editorKeyframes[editorKeyframes.length - 1].time;

  fetch('/api/animations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      duration: duration,
      loop: true,
      keyframes: editorKeyframes
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      showToast('Saved: ' + name, 'info');
      nameInput.value = '';
      editorKeyframes = [];
      renderEditorKeyframes();
      // Refresh animation list
      fetch('/api/animations/status').then(r => r.json()).then(d => updateAnimationUI(d));
    } else {
      showToast(data.error || 'Save failed', 'error');
    }
  })
  .catch(e => showToast('Save error: ' + e.message, 'error'));
}

function animPreviewNew() {
  if (editorKeyframes.length < 2) { showToast('Need at least 2 keyframes', 'error'); return; }

  const duration = editorKeyframes[editorKeyframes.length - 1].time;

  // Save as temporary, play, then delete
  fetch('/api/animations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '__preview__',
      duration: duration,
      loop: true,
      keyframes: editorKeyframes
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      return fetch('/api/animations/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '__preview__', device: 'all', loop: true })
      });
    }
  })
  .then(() => {
    showToast('Previewing animation...', 'info');
    // Clean up temporary preview animation after a short delay
    setTimeout(() => {
      fetch('/api/animations/__preview__', { method: 'DELETE' }).catch(() => {});
    }, 1000);
  })
  .catch(e => showToast('Preview error: ' + e.message, 'error'));
}

function animDeleteSaved(name) {
  fetch('/api/animations/' + encodeURIComponent(name), { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        showToast('Deleted: ' + name, 'info');
        fetch('/api/animations/status').then(r => r.json()).then(d => updateAnimationUI(d));
      }
    })
    .catch(e => showToast('Delete error: ' + e.message, 'error'));
}

// ---- Timer ----

async function startTimer() {
  const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
  const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;
  if (minutes === 0 && seconds === 0) { showToast('Set a time first', 'error'); return; }

  const online = devices.filter(d => d.online);
  if (online.length === 0) { showToast('No devices online', 'error'); return; }

  let ok = 0;
  for (const dev of online) {
    try {
      const res = await fetch('/api/devices/' + dev.id + '/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: '/api/timer', params: { minutes, seconds } })
      });
      if (res.ok) ok++;
    } catch (_) {}
  }
  showToast('Timer started on ' + ok + ' device(s): ' + minutes + 'm ' + seconds + 's', 'success');
}

// ---- OLED Message ----

async function sendOledMessage() {
  const text = document.getElementById('oled-text').value.trim();
  const line = document.getElementById('oled-line').value;
  if (!text) { showToast('Enter a message', 'error'); return; }

  const oledDev = devices.find(d => d.online && d.capabilities && d.capabilities.includes('oled'));
  if (!oledDev) { showToast('No OLED device online', 'error'); return; }

  try {
    const res = await fetch('/api/devices/' + oledDev.id + '/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: '/api/oled', params: { text, line } })
    });
    if (res.ok) {
      showToast('OLED message sent', 'success');
      document.getElementById('oled-text').value = '';
    }
  } catch (_) { showToast('Failed to send OLED message', 'error'); }
}

// ---- Groups ----

let groups = {};

function updateGroupsUI(data) {
  if (!data) return;
  groups = data;
  renderGroupChips();
}

function renderGroupChips() {
  const container = document.getElementById('group-chips');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  const names = Object.keys(groups);
  if (names.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'color:var(--text-dim); font-size:11px';
    empty.textContent = 'No groups';
    container.appendChild(empty);
    return;
  }

  for (const name of names) {
    const chip = document.createElement('span');
    chip.className = 'group-chip';
    chip.textContent = name + ' (' + groups[name].length + ')';

    const remove = document.createElement('span');
    remove.className = 'chip-remove';
    remove.textContent = '\u2715';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGroup(name);
    });

    chip.appendChild(remove);
    container.appendChild(chip);
  }
}

async function createGroup() {
  const nameInput = document.getElementById('group-name');
  const name = nameInput.value.trim();
  if (!name) { showToast('Enter a group name', 'error'); return; }

  // Add all online devices to the group
  const deviceIds = devices.filter(d => d.online).map(d => d.id);
  if (deviceIds.length === 0) { showToast('No devices online', 'error'); return; }

  try {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, devices: deviceIds })
    });
    if (res.ok) {
      showToast('Group "' + name + '" created', 'success');
      nameInput.value = '';
      const data = await res.json();
      if (data.groups) updateGroupsUI(data.groups);
    }
  } catch (_) { showToast('Failed to create group', 'error'); }
}

async function deleteGroup(name) {
  try {
    const res = await fetch('/api/groups/' + encodeURIComponent(name), { method: 'DELETE' });
    if (res.ok) {
      showToast('Group "' + name + '" deleted', 'success');
      const data = await res.json();
      if (data.groups) updateGroupsUI(data.groups);
    }
  } catch (_) { showToast('Failed to delete group', 'error'); }
}

// ---- System / Backup ----

let healthInterval = null;

function fetchHealth() {
  fetch('/api/health')
    .then(r => r.json())
    .then(data => {
      const uptimeEl = document.getElementById('hub-uptime');
      const memEl = document.getElementById('hub-memory');
      if (uptimeEl) uptimeEl.textContent = formatUptime(Math.floor(data.uptime));
      if (memEl) memEl.textContent = formatBytes(data.memory.heapUsed);
    })
    .catch(() => {});
}

function downloadBackup() {
  window.open('/api/system/backup', '_blank');
  showToast('Downloading backup...', 'info');
}

function restoreBackup(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      fetch('/api/system/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(r => r.json())
      .then(result => {
        if (result.ok) {
          showToast('Config restored! Refresh to see changes.', 'success');
        } else {
          showToast(result.error || 'Restore failed', 'error');
        }
      })
      .catch(() => showToast('Restore failed', 'error'));
    } catch (_) {
      showToast('Invalid backup file', 'error');
    }
    fileInput.value = '';
  };
  reader.readAsText(file);
}

// ---- Tools Section Visibility ----

function updateToolsVisibility() {
  const section = document.getElementById('tools-section');
  if (section) {
    const online = devices.some(d => d.online);
    section.style.display = online ? '' : 'none';
  }
  // Show OLED tool only when clock is online with oled capability
  const oledTool = document.getElementById('oled-tool');
  if (oledTool) {
    const clockOnline = devices.some(d => d.online &&
      d.capabilities && d.capabilities.includes('oled'));
    oledTool.style.display = clockOnline ? '' : 'none';
  }
}

// ---- Start ----
connect();
// Fetch health periodically
fetchHealth();
healthInterval = setInterval(fetchHealth, 30000);
// Fetch groups on load
fetch('/api/groups').then(r => r.json()).then(data => {
  if (data && typeof data === 'object') updateGroupsUI(data);
}).catch(() => {});
