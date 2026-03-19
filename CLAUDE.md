# Revamp w Claude - Project Instructions

## Overview
This workspace contains Charlie's hobby hardware projects being revamped with Claude's help.
Three subsystems: Clock (ESP8266), Lamp (ESP8266), and Hub (Node.js) forming a unified LED control system.

## Quick Reference

### Common Commands
```bash
# Hub
cd Hub && npm start              # Run Hub server (port 3000)
cd Hub && npm run dev            # Run with auto-reload (--watch)
cd Hub && npm test               # Run Jest tests (--forceExit --detectOpenHandles)
cd Hub && npm run test:watch     # Run tests in watch mode
pm2 start ecosystem.config.js   # Production mode with auto-restart

# Firmware (Windows paths)
scripts/build-clock.sh           # Compile Clock firmware
scripts/build-lamp.sh            # Compile Lamp firmware
scripts/ota-clock.sh             # OTA upload to Clock (192.168.0.201)
scripts/ota-lamp.sh              # OTA upload to Lamp (192.168.0.202)
```

### Device Quick Ref
| Device | IP | mDNS | LED Count | Port |
|--------|----|-------|-----------|------|
| Clock  | 192.168.0.201 | mirror.local | 60 (ring) | 8266 (OTA) |
| Lamp   | 192.168.0.202 | lamp.local   | 24 (4x6 strips) | 8266 (OTA) |
| Hub    | localhost:3000 | — | — | 3000 (HTTP) |

## Projects

### Clock ("Charlie's Mirror") - FIRMWARE v2.10.0
- **Hardware**: ESP8266 (NodeMCU LoLin v2), 60x WS2812B NeoPixel ring, SSD1306 1.3" OLED
- **Firmware**: `Clock/clock_v2/` - OTA, safe mode, watchdog, telnet, NTP, 25 LED patterns (music + ambient + custom + timer), notification overlay, animation engine, web dashboard
- **Wiring**: ALL SOLDERED - GPIO0=OLED SDA, GPIO2=OLED SCL, GPIO3=NeoPixel DMA
- **Network**: Static IP 192.168.0.201, mDNS mirror.local, SoftAP fallback
- **LEDs**: All 60 active (previously 0, 55-59 were wrongly masked as dead)
- **Capabilities**: color, ntp, oled, patterns, music, ambient, notify, animations, timer (reported in /api/status)
- **Notify**: `/api/notify` overlay (flash/pulse/strobe), auto-revert, priority system
- **Animations**: `/api/animation` + `/api/animation/keyframe` — keyframe interpolation engine, 12 max keyframes
- **Timer**: `/api/timer?minutes=N&seconds=N` — countdown LED pattern (green->yellow->red), auto-revert
- **OLED API**: `/api/oled?text=MSG&line=N` — display custom text on OLED (lines 0-2)
- **Music**: UDP listener on port 4210, 3 patterns (Beat Pulse, Spectrum Ring, Beat Chase)
- **Ambient**: 5 patterns (Daylight NTP-driven, Sunrise 30min ramp, Fireplace, Ocean, Forest)
- **Libraries**: NeoPixelBus (DMA), ESP8266 SSD1306 (ThingPulse), TelnetStream, NTPClient, TimeLib, Timezone
- **Original code**: `Clock/Original Code/clock_original.ino` (reference only)

### Lamp ("Charlie's Lamp") - FIRMWARE v1.6.0
- **Hardware**: ESP8266EX (NodeMCU), 24x WS2812B (4 strips x 6 LEDs), embedded under resin
- **Firmware**: `Lamp/lamp_v1/` - OTA, safe mode, watchdog, telnet, 24 LED patterns (music + ambient + custom + timer), notification overlay, animation engine, morse code, web dashboard
- **Wiring**: 4 strips on separate GPIOs: GPIO2=strip1(top), GPIO4=strip2, GPIO5=strip3, GPIO0=strip4(bottom)
- **Network**: Static IP 192.168.0.202, mDNS lamp.local, SoftAP fallback
- **Capabilities**: color, morse, patterns, music, ambient, notify, animations, timer (reported in /api/status)
- **Notify**: `/api/notify` overlay (flash/pulse/strobe), auto-revert, priority system
- **Animations**: `/api/animation` + `/api/animation/keyframe` — keyframe interpolation engine, 28 max keyframes
- **Timer**: `/api/timer?minutes=N&seconds=N` — countdown LED pattern (green->yellow->red), auto-revert
- **Music**: UDP listener on port 4210, 3 patterns (Beat Glow, Strip Spectrum, Color Pulse)
- **Ambient**: 5 patterns (Daylight Hub-driven via /api/kelvin, Sunrise, Fireplace, Ocean, Forest)
- **Libraries**: NeoPixelBus (BitBang, DMA broken on this chip), TelnetStream
- **Serial**: Available (LEDs not on GPIO3/RX). Telnet also available.
- **Morse**: `morse.h` - non-blocking state machine, ITU timing, A-Z/0-9, adjustable WPM

### Hub - COMPLETE (All 10 phases + enhancements)
- **Stack**: Node.js + Express + WebSocket
- **Location**: `Hub/`
- **Version**: 0.2.0
- **Config**: `Hub/config.json` - device list, polling intervals, port; `.env` for secrets
- **Features**: Device discovery, REST proxy, PWA (Catppuccin Mocha), scenes + scheduling, morse code UI, color temperature, rate limiting, music reactive, ambient/circadian, notifications/webhooks, animation designer, device groups, system health, backup/restore, timer control, OLED messaging
- **Middleware**: CORS, optional Bearer token auth (`HUB_AUTH_TOKEN`), file-based logging with rotation
- **Audio**: `Hub/src/services/audio-manager.js` - FFmpeg capture, FFT, beat detection, UDP broadcast
- **Circadian**: `Hub/src/services/circadian-manager.js` - time-of-day Kelvin, sunrise alarm scheduling
- **Notifications**: `Hub/src/services/notification-manager.js` - webhook endpoint, profiles, weather integration
- **Animations**: `Hub/src/services/animation-manager.js` - keyframe storage, device upload, playback control
- **Groups**: `Hub/src/services/group-manager.js` - named device groups, batch operations
- **System**: `Hub/src/api/system.js` - health endpoint, backup/restore, OTA trigger, firmware info
- **Service Worker**: Network-first strategy (v14), bump version when changing JS/HTML/CSS
- **CSS**: External `Hub/public/css/styles.css` (extracted from inline)
- **Testing**: Jest (`npm test`) — 5 test suites covering health, groups, notifications, animations, circadian
- **Run**: `cd Hub && npm start` (port 3000), `npm run dev` for watch mode

## Development Environment
- **OS**: Windows 11
- **Arduino CLI**: v1.4.1 (at ~/bin/arduino-cli.exe)
- **Board FQBN**: `esp8266:esp8266:nodemcuv2`
- **Node.js**: v24.13.1 (engines: >=18.0.0)
- **Python**: 3.14
- **Git**: Available

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`) runs on push/PR to `master`:

1. **hub-test** — Ubuntu, Node 20, `npm ci && npm test`
2. **firmware-compile** — Arduino CLI, installs ESP8266 board + libraries, compiles both Clock and Lamp

All firmware and Hub tests must pass before merging to master.

## Git Conventions

- **Main branch**: `master`
- **Commit style**: Short descriptive title (<70 chars), verb-led (Add, Fix, Update, Refactor)
- **Co-author**: Claude commits include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- **What to commit**: Source code, config templates, docs. Never commit secrets (`.env`), runtime data (`scenes.json`, `logs/`), or build artifacts (`*.bin`, `build/`)
- **Runtime data files** (auto-generated, gitignored): `Hub/scenes.json`, `Hub/animations.json`, `Hub/notifications.json`, `Hub/groups.json`

## Conventions

### Arduino/ESP
- Compile: `"C:/Users/charl/bin/arduino-cli.exe" compile --fqbn esp8266:esp8266:nodemcuv2 --output-dir "D:/Revamp w Claude/<device>/build" "D:/Revamp w Claude/<device>/"`
- OTA upload: `cd "C:/Users/charl/AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools" && python3 espota.py -i <IP> -p 8266 -P 48266 -f "<path>.bin" -d`
- Build scripts: `scripts/build-clock.sh`, `build-lamp.sh`, `ota-clock.sh`, `ota-lamp.sh`
- ALWAYS compile-test before OTA upload
- OTA uploads must be sequential (both use host port 48266 — parallel fails)
- Serial is DISABLED on clock (DMA conflicts with GPIO3/RX) - use Telnet instead
- Lamp serial is available (LEDs not on GPIO3) but Telnet preferred

### Code Style
- Header files (.h) included from main .ino (single translation unit, not separate .cpp)
- Non-blocking patterns only (state-machine ticks, no delay loops)
- Dead pixel handling via `setPixel()` wrapper
- EEPROM debounced (5s delay) to prevent flash wear
- HTML-escape all user-visible data to prevent XSS
- Use safe DOM methods (createElement/textContent) not innerHTML in web UI JavaScript
- Chunked HTTP responses (`server.setContentLength(CONTENT_LENGTH_UNKNOWN)`) for large pages

### Hub Development
- **Dev mode**: `npm run dev` uses `node --watch` for auto-reload on file changes
- **Production**: `pm2 start ecosystem.config.js` — auto-restart, max 10 retries, 3s delay
- **Auth**: Optional Bearer token via `HUB_AUTH_TOKEN` env var. `/api/health` always public.
- **Environment**: Copy `.env.example` to `.env` to customize PORT, auth token, log level
- **Service worker**: Bump version constant in `sw.js` whenever changing JS/HTML/CSS

### Project Structure
```
Clock/clock_v2/          # Active firmware
  clock_v2.ino           # Main (~1080 lines)
  config.h               # Pin defs, constants, EEPROM layout
  ntp_time.h             # NTP sync, UK timezone
  led_patterns.h         # 23 LED patterns (14 + 3 music + 5 ambient + 1 timer)
  notify.h               # Notification overlay (flash/pulse/strobe)
  build/                 # Compiled binary

Lamp/lamp_v1/            # Active firmware
  lamp_v1.ino            # Main (~810 lines)
  config.h               # Pin defs, constants, EEPROM layout
  led_patterns.h         # 22 LED patterns (13 + 3 music + 5 ambient + 1 timer)
  morse.h                # Morse code encoder (non-blocking)
  notify.h               # Notification overlay (flash/pulse/strobe)
  build/                 # Compiled binary

Hub/                     # Central control server
  server.js              # Express + WebSocket + CORS + auth + logging
  config.json            # Device IPs, polling, port settings
  .env.example           # Environment variable template
  ecosystem.config.js    # PM2 auto-restart config
  src/services/          # Device, scene, audio, circadian, notification, animation, group managers
  src/api/               # REST routes (devices, scenes, audio, circadian, notifications, animations, system, groups)
  src/middleware/         # Auth (Bearer token), logger (file-based with rotation)
  public/                # PWA frontend
    css/styles.css        # Extracted CSS (Catppuccin Mocha + glassmorphism)
    js/app.js             # Client-side JS (safe DOM, WebSocket)
    sw.js                 # Service worker (network-first, v14)
  tests/                 # Jest unit tests

scripts/                 # Build & OTA helper scripts

Shared/
  api-schema.json        # REST API contract — endpoint definitions, request/response schemas
  pattern-defs.json      # Pattern metadata + palettes — used by Hub UI for auto-generating controls
  docs/
    architecture.md      # Master plan, system context, phase overview
    hardware-notes.md    # Hardware details and wiring specs
    project-documentation.md  # Comprehensive project reference
    user-guide.md        # End-user documentation
    claude-efficiency-guide.md  # Context management guide

Clock/Original Code/     # Reference only
```

## Key Technical Notes

### Clock Hardware
- NeoPixelBus DMA on GPIO3 (single 60-LED daisy chain). DMA kills Serial — use Telnet only.
- Clock face overlap: clear-then-layer approach (hour→minute→second priority)
- Clock EEPROM magic: 0xC10C

### Lamp Hardware
- 4 separate strips on 4 GPIOs (2,4,5,0) via BitBang. DMA broken on this chip.
- `showStrip()` sends to each GPIO sequentially with fresh local NeoPixelBus per strip.
- Pin held LOW after each send to prevent destructor pull-up interference.
- `showStrip()` with `CanShow()`+`yield()` before `Show()` prevents BitBang LED dropout.
- Lamp EEPROM magic: 0x1A4B
- WiFi provisioner sketch needed for lamp (writes EEPROM before DMA kills serial)
- Lamp COM port may change on USB replug (was COM3, became COM6)

### Shared Firmware Patterns
- Safe mode skips NeoPixel init for USB recovery (both devices)
- Adaptive brightness delta: >99=step 10, >49=step 5, else=step 1
- WiFi credentials stored in EEPROM bytes 0-63, brightness at 500, mode at 501
- Static IP: capture gateway/subnet into local vars BEFORE calling `WiFi.config()`
- `WiFi.localIP().toString().c_str()` is a dangling pointer — store String in local variable
- OTA progress: use `progress * 100 / total` not `total/100` (div-by-zero when total < 100)
- Firmware reports explicit capabilities array in `/api/status` — Hub prefers this over detection

### Music Reactive Protocol
- Hub broadcasts 8-byte UDP to 192.168.0.255:4210 (magic 0xBE, bass/mid/treble, beat, intensity, dominant, seq)
- ESPs listen with non-blocking `parsePacket()`. 3s timeout → fallback animation.
- FFmpeg captures system audio via dshow (Stereo Mix). Requires Stereo Mix enabled in Windows Sound settings.
