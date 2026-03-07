# Revamp w Claude - Master Plan

## Context
Charlie has two ESP-based LED projects (Clock + Lamp) built 4-5 years ago. The clock firmware v2.4.0 is running with all safety features, NTP clock, 13 LED modes, REST API, and web dashboard. Wires are soldered (DMA on GPIO3). The lamp has working hardware but no code. The goal: a unified, phone-controllable system with music reactivity, ambient lighting, notifications, and custom animations - all controlled from a central hub.

**Completed**: Phases 0-4 (Clock firmware done), Phase 6a (Hub scaffolded)
**Next**: Phase 5 (Lamp bring-up - requires hardware access)

## Architecture

```
    Phone/Tablet (PWA)  ----+
    Laptop Browser      ----+--> Hub (Node.js on PC, port 3000)
                                  |              |
                           HTTP/WS |              | HTTP/WS
                                  v              v
                            Clock (ESP8266)   Lamp (ESP32)
                            mirror.local      lamp.local
                            .201              .202
                            60 NeoPixels      ~30 NeoPixels
```

- **Hub**: Node.js + Express + WebSocket on Charlie's PC. Serves PWA, proxies device APIs, handles audio/notifications.
- **Devices**: Each ESP runs standalone (own web UI + REST API). Hub is additive, not required.
- **Communication**: REST for commands, WebSocket for real-time (color picking, music beats).
- **Patterns run locally** on each ESP at 30fps. Hub sends pattern ID + parameters, not frames.

## Shared REST API (both devices implement)
```
GET  /api/status     -> { device, version, uptime, heap, wifi, mode, brightness }
GET  /api/patterns   -> [{ id, name, params: [{ name, type, min, max }] }]
POST /api/pattern    <- { id: "clock", params: { speed: 1.0 } }
POST /api/color      <- { r, g, b }
POST /api/brightness <- { value: 0-255 }
POST /api/restart
```

---

## Phase 3.5: Clock Rewiring - CANCELLED
**Status**: CANCELLED - Wires are ALL SOLDERED, cannot move.
Solution: Use DMA on GPIO3 (original wiring) instead of UART1 on GPIO2.
DMA kills Serial, but safe mode + telnet provide full recovery/debug.

---

## Phase 4: Clock Feature Port - COMPLETE
All original features ported from `clock_original.ino` into v2 firmware.

### 4a: NTP Time + Clock Face
- Add NTPClient, TimeLib, Timezone libraries
- Create `ntp_time.h/.cpp` - UK timezone (BST/GMT auto-switch)
- Create `led_manager.h/.cpp` - dead pixel map (LEDs 0,55-59 dead, 54 degraded)
- Create `patterns.h/.cpp` - non-blocking clock face pattern
- OLED shows time + date (port from original lines 380-422)
- **Files**: `Clock/clock_v2/ntp_time.h`, `led_manager.h`, `patterns.h`

### 4b: Solid Colors + Brightness
- Patterns: solid red/green/blue/white
- Brightness: adaptive delta (10/5/1 based on level), persist to EEPROM
- REST endpoints: `POST /api/brightness`, `POST /api/pattern`
- Mode persistence to EEPROM byte 501

### 4c: Special Animated Patterns (Non-Blocking)
- Refactor Special1-3 from blocking `while()` to state-machine ticks
- Replace Special4 (empty) with rainbow cycle
- Add new: candle flicker, color wave, sparkle

### 4d: Web Interface Upgrade
- Mode selection, brightness slider, WiFi config form
- `GET /api/wifi/scan` - list networks
- `POST /api/wifi/config` - save credentials
- EEPROM magic number validation (bytes 510-511)
- **Chunked responses** to minimize heap fragmentation

---

## Phase 5: Lamp Bring-Up

### 5a: Hardware Identification
- Inspect MCU chip markings (ESP32 expected)
- USB connect, determine COM port and board type
- Install ESP32 board support: `arduino-cli core install esp32:esp32`
- Create `Lamp/pin_scanner/` - systematically find LED data pin + count
- Document in `Lamp/docs/hardware-notes.md`

### 5b: Basic Lamp Firmware
- Mirror clock v2 safety architecture: OTA, safe mode, watchdog, telnet, mDNS
- `lamp.local` at 192.168.0.202
- Same REST API contract as clock
- Basic LED control: on/off, solid colors, brightness

### 5c: Lamp Features
- Morse code encoder (`morse.h/.cpp`) - non-blocking playback
- REST: `POST /api/morse` <- `{ "text": "HELLO" }`
- Smooth color transitions (fade over N ms)

---

## Phase 6: Central Hub

### 6a: Hub Foundation - COMPLETE
- `Hub/` directory, Node.js + Express + WebSocket
- Device discovery via static IPs (mirror auto-discovered on start)
- Health checks every 10s
- API proxy: `/api/devices/:id/*` -> ESP device
- All-devices broadcast endpoints
- **Files**: `Hub/server.js`, `Hub/src/services/device-manager.js`, `Hub/src/api/routes.js`

### 6b: PWA Control Panel
- Dark theme single-page app (`#1a1a2e` background, `#00d4ff` accents)
- Device cards with status, quick controls
- HSV color picker with live preview (throttled WebSocket updates)
- Auto-generated pattern controls from `/api/patterns` schema
- PWA manifest + service worker for phone install
- **Files**: `Hub/public/index.html`, `manifest.json`, `sw.js`, `js/*.js`

### 6c: Scenes and Scheduling
- Scenes: saved snapshots of all device states
- Groups: "All devices" commands
- Scheduled scenes via `node-cron` (e.g., sunrise alarm at 7 AM)
- **Files**: `Hub/scenes.json`, `Hub/src/api/scenes.js`

---

## Phase 7: Music Reactive

### 7a: Audio Capture
- Windows audio loopback via WASAPI (fallback: ffmpeg, Python sounddevice)
- FFT on 1024-sample windows -> bass/mid/treble energy bands
- Beat detection (bass > 1.5x running average)
- Broadcast 20-30 beat packets/sec via WebSocket to ESPs
- **Files**: `Hub/src/services/audio-analyzer.js`, `Hub/src/api/audio.js`

### 7b: Music Patterns
- WebSocket client on ESPs (receives beat data from hub)
- Clock: beat pulse, spectrum bar, beat chase
- Lamp: color pulse, beat glow
- Hub UI: audio visualizer + per-device toggle

---

## Phase 8: Ambient & Mood Lighting
- Time-of-day color temperature curve (warm night, cool day)
- Sunrise alarm: 30-min ramp from dark -> red -> orange -> warm white
- Themed palettes: candle, fireplace, ocean, forest
- Defined in `Shared/pattern-defs.json`

## Phase 9: Notifications
- Hub webhook endpoint: `POST /api/notify`
- Phone -> IFTTT/Tasker -> hub webhook -> LED flash sequence
- Weather: OpenWeatherMap polling every 15 min
- Calendar: Google Calendar ICS URL polling
- Configurable per-app colors and patterns

## Phase 10: Custom Animation Designer (Stretch)
- Web canvas showing LED ring/strip
- Timeline with keyframes, color per LED
- Interpolation preview in browser
- Export as frame sequence, send to ESP

---

## Directory Structure
```
D:\Revamp w Claude\
+-- Clock\
|   +-- clock_v2\          # Active firmware
|   |   +-- clock_v2.ino, config.h
|   |   +-- ntp_time.h/.cpp, led_manager.h/.cpp
|   |   +-- patterns.h/.cpp, web_api.h/.cpp
|   +-- Original Code\     # Reference
+-- Lamp\
|   +-- lamp_v1\           # Lamp firmware (Phase 5)
|   |   +-- lamp_v1.ino, config.h
|   |   +-- patterns.h/.cpp, morse.h/.cpp
+-- Hub\
|   +-- server.js           # Express + WS entry point
|   +-- src/api/            # REST routes
|   +-- src/services/       # Device mgr, audio, notifications
|   +-- public/             # PWA (HTML/CSS/JS)
+-- Shared\
|   +-- api-schema.json     # REST contract
|   +-- pattern-defs.json   # Pattern metadata + palettes
```

---

## Execution Order
```
3.5 (Rewire) -> 4a (NTP/Clock) -> 4b (Colors) -> 5a (Lamp ID)
-> 4c (Specials) -> 5b (Lamp FW) -> 4d (Web UI) -> 5c (Morse)
-> 6a (Hub) -> 6b (PWA) -> 6c (Scenes)
-> 7a (Audio) -> 7b (Music Patterns)
-> 8 (Ambient) -> 9 (Notifications) -> 10 (Designer)
```

Clock and lamp phases interleave for parallelism.

## Testing Strategy
- **Every phase**: compile test, OTA deploy, crash counter verification, heap monitoring
- **Firmware**: WiFi stress test (10 req/s for 60s), telnet status check, visual LED verification
- **Hub**: Node.js unit tests, mock ESP integration tests, Lighthouse PWA audit
- **End-to-end**: phone PWA -> hub -> ESP -> LEDs (target < 200ms latency)
- **Memory tracking**: record flash%, RAM%, runtime heap after each phase in `clock-progress.md`

## Documentation
- `Shared/docs/architecture.md` - this plan (living document)
- `Clock/docs/api-reference.md` + `Lamp/docs/api-reference.md` - REST API docs
- `Hub/docs/setup-guide.md` - how to start the hub
- `Hub/docs/pwa-install.md` - phone installation steps
- Memory files: `clock-progress.md`, `lamp-progress.md` - phase-by-phase logs
- Code: header comments in every `.h`, one-liner on every function
