# Revamp w Claude - Project Instructions

## Overview
This workspace contains Charlie's hobby hardware projects being revamped with Claude's help.
Three subsystems: Clock (ESP8266), Lamp (ESP32), and Hub (Node.js) forming a unified LED control system.

## Projects

### Clock ("Charlie's Mirror") - FIRMWARE COMPLETE (v2.4.0)
- **Hardware**: ESP8266 (NodeMCU LoLin v2), 60x WS2812B NeoPixel ring, SSD1306 1.3" OLED
- **Firmware**: `Clock/clock_v2/` - OTA, safe mode, watchdog, telnet, NTP, 13 LED patterns, web dashboard
- **Wiring**: ALL SOLDERED - GPIO0=OLED SDA, GPIO2=OLED SCL, GPIO3=NeoPixel DMA
- **Network**: Static IP 192.168.0.201, mDNS mirror.local, SoftAP fallback
- **Dead LEDs**: 0, 55-59 (6 dead), LED 54 degraded (yellow tint)
- **Libraries**: NeoPixelBus (DMA), ESP8266 SSD1306 (ThingPulse), TelnetStream, NTPClient, TimeLib, Timezone
- **Original code**: `Clock/Original Code/clock_original.ino` (reference only)

### Lamp - NOT STARTED
- **Hardware**: Likely ESP32, ~30 addressable LEDs embedded in resin
- **Physical**: Wooden + resin lamp, turned on a wood lathe
- **Features planned**: Mirror clock safety architecture, morse code, color control
- **Location**: `Lamp/`
- **Target**: lamp.local at 192.168.0.202

### Hub - SCAFFOLDED
- **Stack**: Node.js + Express + WebSocket
- **Location**: `Hub/`
- **Features**: Device discovery, REST proxy, PWA control panel
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
- Always prefix with: `export PATH="$HOME/bin:$PATH"`
- Compile: `arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 --output-dir "D:/Revamp w Claude/Clock/clock_v2/build" "D:/Revamp w Claude/Clock/clock_v2/"`
- OTA upload: `cd "C:/Users/charl/AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools" && python3 espota.py -i 192.168.0.201 -p 8266 -P 48266 -f "<path>/clock_v2.ino.bin" -d`
- ALWAYS compile-test before OTA upload
- Serial is DISABLED on clock (DMA conflicts with GPIO3/RX) - use Telnet instead

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

Hub/                     # Central control server
  server.js              # Express + WebSocket
  src/services/          # Device manager
  src/api/               # REST routes
  public/                # PWA frontend

Shared/
  api-schema.json        # REST API contract
  pattern-defs.json      # Pattern metadata + palettes

Clock/Original Code/     # Reference only
```

## Key Technical Notes
- ESP8266 NeoPixelBus DMA is hardwired to GPIO3 - cannot be changed
- DMA kills Serial but safe mode skips NeoPixel init for USB recovery
- EEPROM magic number 0xC10C validates stored mode/brightness
- Adaptive brightness delta: >99=step 10, >49=step 5, else=step 1
- WiFi credentials stored in EEPROM bytes 0-63, brightness at 500, mode at 501
- Clock face overlap: clear-then-layer approach (hour→minute→second priority)
