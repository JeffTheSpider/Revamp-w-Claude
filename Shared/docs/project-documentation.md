# Revamp w Claude - Complete Project Documentation

## Overview
A unified LED control system built around two ESP8266 devices (Clock + Lamp) and a central Hub (Node.js). Originally built ~4-5 years ago by Charlie and his uncle, completely revamped with modern firmware, web dashboard, PWA control, music reactivity, ambient lighting, notifications, and custom animations.

## System Architecture

```
    Phone/Tablet (PWA)  ----+
    Laptop Browser      ----+--> Hub (Node.js on PC, port 3000)
                                  |              |           |
                           HTTP/WS|              |HTTP/WS    |UDP 4210
                                  v              v           |
                            Clock (ESP8266)   Lamp (ESP8266) |
                            mirror.local      lamp.local     |
                            .201              .202           |
                            60 NeoPixels      24 NeoPixels   |
                                  ^              ^           |
                                  +---- Music UDP broadcast--+
```

- **Hub**: Node.js + Express + WebSocket on Charlie's PC. Serves PWA, proxies device APIs, handles audio/notifications.
- **Devices**: Each ESP runs standalone (own web UI + REST API). Hub is additive, not required.
- **Communication**: REST for commands, WebSocket for real-time (color picking, music beats).
- **Patterns run locally** on each ESP at 30fps. Hub sends pattern ID + parameters, not frames.
- **Music**: Hub captures system audio via FFmpeg, runs FFT + beat detection, broadcasts 8-byte UDP packets to 192.168.0.255:4210.

---

## Clock ("Charlie's Mirror")

### Hardware
- **MCU**: ESP8266 (NodeMCU LoLin v2), 4MB flash, CH340 USB
- **LEDs**: 60x WS2812B NeoPixel ring (daisy-chained)
- **Display**: SSD1306 1.3" OLED (I2C)
- **Wiring**: All soldered (cannot be moved)
  - GPIO0 = OLED SDA
  - GPIO2 = OLED SCL
  - GPIO3 = NeoPixel data (DMA/I2S method)
- **Network**: Static IP 192.168.0.201, mDNS mirror.local
- **Serial**: DISABLED (DMA on GPIO3 conflicts with RX). Use Telnet instead.

### Firmware (v2.9.0)
- **Location**: `Clock/clock_v2/`
- **Files**: `clock_v2.ino`, `config.h`, `ntp_time.h`, `led_patterns.h`, `notify.h`, `animations.h`
- **Build**: ~373KB flash (35%), ~47.6KB RAM (59%)
- **Features**:
  - OTA updates (port 8266, espota.py)
  - Safe mode (skips NeoPixel for recovery)
  - Hardware watchdog (8s timeout)
  - Telnet debug console
  - NTP time sync (UK timezone, auto DST)
  - OLED clock display
  - 24 LED patterns (14 base + 3 music + 5 ambient + custom + off)
  - Web dashboard with REST API
  - WiFi config via EEPROM
  - Notification overlay system (flash/pulse/strobe)
  - Keyframe animation playback engine

### LED Patterns (24 total)
| # | ID | Name | Type |
|---|-----|------|------|
| 0 | clock | Clock | Base |
| 1 | red | Red | Base |
| 2 | green | Green | Base |
| 3 | blue | Blue | Base |
| 4 | white | White | Base |
| 5 | special1 | Blue Flash | Base |
| 6 | wedge | Wedge | Base |
| 7 | special3 | Sweep | Base |
| 8 | rainbow | Rainbow | Base |
| 9 | candle | Candle | Base |
| 10 | wave | Color Wave | Base |
| 11 | sparkle | Sparkle | Base |
| 12 | color | Custom Color | Base |
| 13 | beat_pulse | Beat Pulse | Music |
| 14 | spectrum | Spectrum Ring | Music |
| 15 | beat_chase | Beat Chase | Music |
| 16 | daylight | Daylight | Ambient |
| 17 | sunrise | Sunrise | Ambient |
| 18 | fireplace | Fireplace | Ambient |
| 19 | ocean | Ocean | Ambient |
| 20 | forest | Forest | Ambient |
| 21 | off | Off | Control |
| 22 | custom | Custom Anim | Animation |

### Capabilities
`["color", "ntp", "oled", "patterns", "music", "ambient", "notify", "animations"]`

---

## Lamp ("Charlie's Lamp")

### Hardware
- **MCU**: ESP8266EX (NodeMCU), 4MB flash, CH340 USB
- **LEDs**: 24x WS2812B, 4 strips x 6 LEDs, embedded under resin
- **Wiring**: 4 strips on separate GPIOs (NOT daisy-chained, NOT on GPIO3)
  - GPIO2 = Strip 1 (top, connector D1)
  - GPIO4 = Strip 2 (connector D2)
  - GPIO5 = Strip 3 (connector D3)
  - GPIO0 = Strip 4 (bottom, connector D4)
- **Network**: Static IP 192.168.0.202, mDNS lamp.local
- **Serial**: Available (LEDs not on GPIO3). Telnet also available.

### Firmware (v1.5.0)
- **Location**: `Lamp/lamp_v1/`
- **Files**: `lamp_v1.ino`, `config.h`, `led_patterns.h`, `morse.h`, `notify.h`, `animations.h`
- **Build**: ~338KB flash (32%), ~46.5KB RAM (58%)
- **Features**:
  - Same as Clock minus OLED and NTP
  - Morse code encoder (non-blocking state machine)
  - Multi-GPIO LED output via `showStrip()` (BitBang, fresh NeoPixelBus per strip)
  - Daylight pattern driven by Hub (receives Kelvin via /api/kelvin)

### LED Patterns (23 total)
| # | ID | Name | Type |
|---|-----|------|------|
| 0-12 | (various) | Base patterns | Base |
| 13 | beat_glow | Beat Glow | Music |
| 14 | strip_spectrum | Strip Spectrum | Music |
| 15 | color_pulse | Color Pulse | Music |
| 16-20 | (ambient) | Ambient patterns | Ambient |
| 21 | off | Off | Control |
| 22 | custom | Custom Anim | Animation |

### Capabilities
`["color", "morse", "patterns", "music", "ambient", "notify", "animations"]`

---

## Hub (Central Control Server)

### Stack
- Node.js v24 + Express + WebSocket
- Location: `Hub/`
- Port: 3000 (configurable via config.json)
- Run: `cd Hub && npm start`

### Services

#### DeviceManager (`src/services/device-manager.js`)
- Discovers and polls ESP devices every 10s
- Maintains online/offline status
- Exponential backoff for failed polls
- `sendCommand()` (GET) and `sendPost()` (POST) for device communication
- Emits: statusUpdate, deviceOnline, deviceOffline

#### SceneManager (`src/services/scene-manager.js`)
- Save/load device state snapshots
- Scheduled scene activation (cron-based via node-cron)
- Persists to `scenes.json`

#### AudioManager (`src/services/audio-manager.js`)
- Captures system audio via FFmpeg (dshow, Stereo Mix)
- FFT analysis (1024-point, 50% overlap)
- Beat detection (bass energy threshold)
- UDP broadcast to 192.168.0.255:4210
- 8-byte packet: magic(0xBE), bass, mid, treble, beat, intensity, dominant, seq

#### CircadianManager (`src/services/circadian-manager.js`)
- Time-of-day color temperature (2700K-6500K curve)
- Sends Kelvin to devices in daylight mode every 60s
- Sunrise alarm scheduling (30min ramp before wake time)

#### NotificationManager (`src/services/notification-manager.js`)
- External webhook endpoint with API key auth
- Named notification profiles (alert, info, success)
- OpenWeatherMap integration (weather-to-LED mapping)
- Notification history (last 50)
- Persists to `notifications.json`

#### AnimationManager (`src/services/animation-manager.js`)
- Keyframe-based animation storage and management
- Upload animations to devices via /api/animation/keyframe
- Playback control (play/stop on individual or all devices)
- 3 built-in presets: Color Cycle, Warm Breathe, Police Lights
- Persists to `animations.json`

### API Routes

#### Core (`src/api/routes.js`)
```
GET  /api/devices              All device statuses
POST /api/devices/:id/pattern  Set pattern
POST /api/devices/:id/color    Set color
POST /api/devices/:id/brightness  Set brightness
GET  /api/devices/all/pattern  Set pattern on all
```

#### Scenes (`src/api/scenes.js`)
```
GET    /api/scenes              List scenes
POST   /api/scenes/capture      Capture current state
POST   /api/scenes/create       Create from data
PUT    /api/scenes/:name        Update schedule
DELETE /api/scenes/:name        Delete scene
POST   /api/scenes/:name/activate  Activate scene
```

#### Audio (`src/api/audio.js`)
```
POST /api/audio/start    Start audio capture
POST /api/audio/stop     Stop audio capture
GET  /api/audio/status   Get audio status
POST /api/audio/sensitivity  Set sensitivity
```

#### Circadian (`src/api/circadian.js`)
```
POST /api/circadian/start    Start circadian loop
POST /api/circadian/stop     Stop circadian loop
GET  /api/circadian/status   Get circadian status
POST /api/circadian/sunrise  Set sunrise alarm
DELETE /api/circadian/sunrise  Remove alarm
```

#### Notifications (`src/api/notifications.js`)
```
POST /api/notify              Webhook (API key required)
POST /api/notifications/send  Internal send
POST /api/notifications/test  Test notification
GET  /api/notifications/status  Status + history count
GET  /api/notifications/config  Profiles + weather config
POST /api/notifications/config  Update config
```

#### Animations (`src/api/animations.js`)
```
GET    /api/animations          List saved animations
GET    /api/animations/status   Playback status
POST   /api/animations          Save animation
POST   /api/animations/play     Play on device(s)
POST   /api/animations/stop     Stop on device(s)
GET    /api/animations/:name    Get animation data
DELETE /api/animations/:name    Delete animation
```

### PWA Frontend
- **Theme**: Catppuccin Mocha with glassmorphism
- **Features**: Device cards, color picker, pattern selector, audio visualizer, ambient controls, notification management, animation designer, scene management
- **Service Worker**: Network-first strategy (v13)
- **Security**: Safe DOM methods (createElement/textContent), no innerHTML with user data

---

## Development

### Build Commands
```bash
# Compile Clock
"C:/Users/charl/bin/arduino-cli.exe" compile --fqbn esp8266:esp8266:nodemcuv2 \
  --output-dir "D:/Revamp w Claude/Clock/build" "D:/Revamp w Claude/Clock/clock_v2/"

# Compile Lamp
"C:/Users/charl/bin/arduino-cli.exe" compile --fqbn esp8266:esp8266:nodemcuv2 \
  --output-dir "D:/Revamp w Claude/Lamp/build" "D:/Revamp w Claude/Lamp/lamp_v1/"

# OTA Upload Clock
cd "C:/Users/charl/AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools"
python3 espota.py -i 192.168.0.201 -p 8266 -P 48266 -f "<path>/clock_v2.ino.bin" -d

# OTA Upload Lamp (MUST be sequential with Clock - both use port 48266)
python3 espota.py -i 192.168.0.202 -p 8266 -P 48266 -f "<path>/lamp_v1.ino.bin" -d

# Start Hub
cd Hub && npm start
```

### Key Technical Notes
1. **DMA on GPIO3**: Kills CH340 USB-serial. Safe mode = recovery path.
2. **BitBang multi-GPIO**: Lamp creates fresh NeoPixelBus per strip, sends 6 pixels, holds pin LOW. `showStrip()` with `CanShow()+yield()` before `Show()` prevents dropout.
3. **NeoPixelBus destructor**: Sets pin to INPUT (pull-up). Must override to OUTPUT LOW after send.
4. **WiFi.localIP().toString().c_str()**: Dangling pointer. Store String in local variable first.
5. **OTA progress**: Use `progress * 100 / total` not `total/100` (div-by-zero when total < 100).
6. **ESP8266 FPU**: No hardware FPU. Use `sinf()` not `sin()`, `f` suffix on float literals, integer math where possible.
7. **EEPROM debounce**: 5s delay to prevent flash wear.
8. **Service Worker**: Bump cache version (`sw.js` CACHE_NAME) when changing JS/HTML.
9. **DeviceManager.getAll()**: Returns Array, not Map/Object. Use `.filter().map()` not `Object.entries()`.
10. **Express route ordering**: Specific routes (e.g., `/status`) MUST be registered before parameterized routes (e.g., `/:name`).
11. **Parallel OTA**: Both devices use host port 48266. Upload sequentially.
12. **Enum ordering**: MODE_CUSTOM placed after MODE_OFF to preserve EEPROM mode indices.

---

## Lessons Learned

### Hardware
- ESP8266 DMA on GPIO3 is excellent for NeoPixels but kills serial communication
- BitBang with short strips (6 LEDs) has negligible WiFi impact (~0.18ms interrupt disable)
- Pin scanner using temp NeoPixelBus instances can test any GPIO at runtime
- JST connector disconnect required before USB upload when NeoPixel is on GPIO3
- COM port may change on USB replug (lamp was COM3, then COM6)
- WiFi SSID is case-sensitive

### Firmware
- Non-blocking patterns only (state-machine ticks, no delay loops)
- Safe mode is essential for DMA-serial conflict recovery
- `showStrip()` wrapper: NEVER call self (infinite recursion bricking via tail-call optimization)
- ESP8266 GCC tail-call optimizes self-recursion into non-crashing infinite loop (no WDT reset)
- GPIO3 PIN_FUNC_SELECT to FUNC_GPIO3 before strip.Begin() BREAKS DMA
- Crash counter recovery: disconnect USB cable first (dodgy cable DTR/RTS interference)
- sinf() is significantly faster than sin() on ESP8266 (software FPU)
- Integer modulo for rainbow hue faster than fmod()
- String concatenation in logging causes heap churn - use snprintf

### Hub & PWA
- PWA service worker cache-first strategy serves stale JS. Use network-first + bump cache version.
- innerHTML with user data = XSS. Use createElement/textContent.
- WebSocket reconnect: use setTimeout not setInterval to prevent duplicate connections.
- DeviceManager.getAll() returns Array - use .filter().map() not Object.entries().
- Express route ordering: `/api/animations/status` must come before `/api/animations/:name`.
- Math.random() is not cryptographically secure for API keys. Use crypto.randomBytes().
- Scene async writeFile can race on concurrent saves. Consider writeFileSync for small files.

### Development Process
- Always compile-test before OTA upload
- OTA uploads must be sequential (both use host port 48266)
- Forward declarations resolve include-order dependencies in single-translation-unit architecture
- Inserting enum values changes EEPROM-stored mode indices - place new modes at end
- Test with direct curl to ESP before testing through Hub to isolate issues
- GET vs POST: ESP8266WebServer handles both via server.on(), but Node.js http.request needs careful configuration

---

## Project History

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Clock safety features (OTA, safe mode, watchdog) | Complete |
| 1 | Clock telnet debug | Complete |
| 2 | Clock NeoPixel + OLED | Complete |
| 3 | Clock feature port (NTP, patterns) | Complete |
| 4 | Clock web dashboard + REST API | Complete |
| 5 | Lamp bring-up (4-strip BitBang, dashboard) | Complete |
| 6 | Hub (Node.js, PWA, device management) | Complete |
| 7 | Music Reactive (FFmpeg, FFT, UDP, LED patterns) | Complete |
| 8 | Ambient Lighting (circadian, sunrise, nature) | Complete |
| 9 | Notifications (webhook, profiles, weather) | Complete |
| 10 | Animation Designer (keyframe engine, PWA editor) | Complete |

## File Structure
```
D:\Revamp w Claude\
  Clock\
    clock_v2\           # Active firmware
      clock_v2.ino      # Main (~1100 lines)
      config.h          # Pin defs, constants, EEPROM layout
      ntp_time.h        # NTP sync, UK timezone
      led_patterns.h    # 24 LED patterns
      notify.h          # Notification overlay (flash/pulse/strobe)
      animations.h      # Keyframe animation engine
      build\            # Compiled binary
    Original Code\      # Reference only
  Lamp\
    lamp_v1\            # Active firmware
      lamp_v1.ino       # Main (~830 lines)
      config.h          # Pin defs, constants, EEPROM layout
      led_patterns.h    # 23 LED patterns
      morse.h           # Morse code encoder
      notify.h          # Notification overlay
      animations.h      # Keyframe animation engine
      build\            # Compiled binary
  Hub\
    server.js           # Express + WebSocket + rate limiting
    config.json         # Device IPs, polling intervals
    src\
      services\         # DeviceManager, SceneManager, AudioManager,
                        # CircadianManager, NotificationManager, AnimationManager
      api\              # REST routes (devices, scenes, audio, circadian,
                        # notifications, animations)
    public\             # PWA frontend (Catppuccin Mocha)
      index.html        # Single-page app
      js\app.js         # PWA logic (~1600 lines)
      sw.js             # Service worker (v13)
      manifest.json     # PWA manifest
  Shared\
    docs\               # Project documentation
    api-schema.json     # REST API contract
    pattern-defs.json   # Pattern metadata
  scripts\              # Build & OTA helper scripts
  CLAUDE.md             # Project instructions for Claude
```
