# Revamp w Claude - Project Instructions

## Overview
This workspace contains Charlie's hobby hardware projects being revamped with Claude's help.
Three subsystems: Clock (ESP8266), Lamp (ESP8266), and Hub (Node.js) forming a unified LED control system.

## Projects

### Clock ("Charlie's Mirror") - FIRMWARE v2.5.0
- **Hardware**: ESP8266 (NodeMCU LoLin v2), 60x WS2812B NeoPixel ring, SSD1306 1.3" OLED
- **Firmware**: `Clock/clock_v2/` - OTA, safe mode, watchdog, telnet, NTP, 14 LED patterns, web dashboard
- **Wiring**: ALL SOLDERED - GPIO0=OLED SDA, GPIO2=OLED SCL, GPIO3=NeoPixel DMA
- **Network**: Static IP 192.168.0.201, mDNS mirror.local, SoftAP fallback
- **LEDs**: All 60 active (previously 0, 55-59 were wrongly masked as dead)
- **Capabilities**: color, ntp, oled, patterns (reported in /api/status)
- **Libraries**: NeoPixelBus (DMA), ESP8266 SSD1306 (ThingPulse), TelnetStream, NTPClient, TimeLib, Timezone
- **Original code**: `Clock/Original Code/clock_original.ino` (reference only)

### Lamp ("Charlie's Lamp") - FIRMWARE v1.1.0
- **Hardware**: ESP8266EX (NodeMCU), 24x WS2812B (4 strips x 6 LEDs), embedded under resin
- **Firmware**: `Lamp/lamp_v1/` - OTA, safe mode, watchdog, telnet, 13 LED patterns, morse code, web dashboard
- **Wiring**: 4 strips on separate GPIOs: GPIO2=strip1(top), GPIO4=strip2, GPIO5=strip3, GPIO0=strip4(bottom)
- **Network**: Static IP 192.168.0.202, mDNS lamp.local, SoftAP fallback
- **Capabilities**: color, morse, patterns (reported in /api/status)
- **Libraries**: NeoPixelBus (BitBang, DMA broken on this chip), TelnetStream
- **Serial**: Available (LEDs not on GPIO3/RX). Telnet also available.
- **Morse**: `morse.h` - non-blocking state machine, ITU timing, A-Z/0-9, adjustable WPM

### Hub - FUNCTIONAL (Phase 6 + improvement sprint)
- **Stack**: Node.js + Express + WebSocket
- **Location**: `Hub/`
- **Config**: `Hub/config.json` - device list, polling intervals, port
- **Features**: Device discovery, REST proxy, PWA control panel (Catppuccin Mocha theme), scenes + scheduling, morse code UI, color temperature slider, rate limiting, device ID validation
- **Service Worker**: Network-first strategy (v9), bump version when changing JS/HTML
- **Run**: `cd Hub && npm start` (port 3000)

## Development Environment
- **OS**: Windows 11
- **Arduino CLI**: v1.4.1 (at ~/bin/arduino-cli.exe)
- **Board FQBN**: `esp8266:esp8266:nodemcuv2`
- **Node.js**: v24.13.1
- **Python**: 3.14
- **Git**: Available

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

### Project Structure
```
Clock/clock_v2/          # Active firmware
  clock_v2.ino           # Main (~1000 lines)
  config.h               # Pin defs, constants, EEPROM layout
  ntp_time.h             # NTP sync, UK timezone
  led_patterns.h         # 13 LED patterns, dead pixel map
  build/                 # Compiled binary

Lamp/lamp_v1/            # Active firmware
  lamp_v1.ino            # Main (~730 lines)
  config.h               # Pin defs, constants, EEPROM layout
  led_patterns.h         # 12 LED patterns (no dead pixels)
  build/                 # Compiled binary

Hub/                     # Central control server
  server.js              # Express + WebSocket + rate limiting
  config.json            # Device IPs, polling, port settings
  src/services/          # Device manager, scene manager
  src/api/               # REST routes (devices, scenes) + device ID validation
  public/                # PWA frontend (Catppuccin Mocha glassmorphism)

scripts/                 # Build & OTA helper scripts

Shared/
  api-schema.json        # REST API contract
  pattern-defs.json      # Pattern metadata + palettes

Clock/Original Code/     # Reference only
```

## Key Technical Notes
- **Clock**: NeoPixelBus DMA on GPIO3 (single 60-LED daisy chain). DMA kills Serial.
- **Lamp**: 4 separate strips on 4 GPIOs (2,4,5,0) via BitBang. DMA broken on this chip.
  showStrip() sends to each GPIO sequentially with fresh local NeoPixelBus per strip.
  Pin held LOW after each send to prevent destructor pull-up interference.
- Safe mode skips NeoPixel init for USB recovery (both devices)
- Clock EEPROM magic: 0xC10C, Lamp EEPROM magic: 0x1A4B
- Adaptive brightness delta: >99=step 10, >49=step 5, else=step 1
- WiFi credentials stored in EEPROM bytes 0-63, brightness at 500, mode at 501
- Clock face overlap: clear-then-layer approach (hour→minute→second priority)
- WiFi provisioner sketch needed for lamp (writes EEPROM before DMA kills serial)
- Lamp COM port may change on USB replug (was COM3, became COM6)
- Static IP: capture gateway/subnet into local vars BEFORE calling WiFi.config()
- WiFi.localIP().toString().c_str() is a dangling pointer — store String in local variable
- showStrip() with CanShow()+yield() before Show() prevents BitBang LED dropout
- OTA progress: use `progress * 100 / total` not `total/100` (div-by-zero when total < 100)
- Firmware reports explicit capabilities array in /api/status — Hub prefers this over detection
