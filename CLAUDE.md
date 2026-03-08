# Revamp w Claude - Project Instructions

## Overview
This workspace contains Charlie's hobby hardware projects being revamped with Claude's help.
Three subsystems: Clock (ESP8266), Lamp (ESP8266), and Hub (Node.js) forming a unified LED control system.

## Projects

### Clock ("Charlie's Mirror") - FIRMWARE COMPLETE (v2.4.0)
- **Hardware**: ESP8266 (NodeMCU LoLin v2), 60x WS2812B NeoPixel ring, SSD1306 1.3" OLED
- **Firmware**: `Clock/clock_v2/` - OTA, safe mode, watchdog, telnet, NTP, 13 LED patterns, web dashboard
- **Wiring**: ALL SOLDERED - GPIO0=OLED SDA, GPIO2=OLED SCL, GPIO3=NeoPixel DMA
- **Network**: Static IP 192.168.0.201, mDNS mirror.local, SoftAP fallback
- **Dead LEDs**: 0, 55-59 (6 dead), LED 54 degraded (yellow tint)
- **Libraries**: NeoPixelBus (DMA), ESP8266 SSD1306 (ThingPulse), TelnetStream, NTPClient, TimeLib, Timezone
- **Original code**: `Clock/Original Code/clock_original.ino` (reference only)

### Lamp ("Charlie's Lamp") - FIRMWARE COMPLETE (v1.0.0 + morse)
- **Hardware**: ESP8266EX (NodeMCU), 24x WS2812B (4 strips x 6 LEDs), embedded under resin
- **Firmware**: `Lamp/lamp_v1/` - OTA, safe mode, watchdog, telnet, 12 LED patterns, morse code, web dashboard
- **Wiring**: GPIO3=NeoPixel DMA (same as clock), GPIO0=FLASH button
- **Network**: Static IP 192.168.0.202, mDNS lamp.local, SoftAP fallback
- **Libraries**: NeoPixelBus (DMA), TelnetStream
- **Serial**: DISABLED (DMA conflicts with GPIO3/RX) - use Telnet instead
- **Morse**: `morse.h` - non-blocking state machine, ITU timing, A-Z/0-9, adjustable WPM

### Hub - FUNCTIONAL (Phase 6c + morse UI)
- **Stack**: Node.js + Express + WebSocket
- **Location**: `Hub/`
- **Features**: Device discovery, REST proxy, PWA control panel, scenes + scheduling, morse code UI
- **Service Worker**: Network-first strategy (v3), bump version when changing JS/HTML
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

Lamp/lamp_v1/            # Active firmware
  lamp_v1.ino            # Main (~730 lines)
  config.h               # Pin defs, constants, EEPROM layout
  led_patterns.h         # 12 LED patterns (no dead pixels)
  build/                 # Compiled binary

Hub/                     # Central control server
  server.js              # Express + WebSocket
  src/services/          # Device manager, scene manager
  src/api/               # REST routes (devices, scenes)
  public/                # PWA frontend

Shared/
  api-schema.json        # REST API contract
  pattern-defs.json      # Pattern metadata + palettes

Clock/Original Code/     # Reference only
```

## Key Technical Notes
- ESP8266 NeoPixelBus DMA is hardwired to GPIO3 - cannot be changed
- DMA kills Serial but safe mode skips NeoPixel init for USB recovery
- Both devices use identical DMA GPIO3 wiring (uncle built both)
- Clock EEPROM magic: 0xC10C, Lamp EEPROM magic: 0x1A4B
- Adaptive brightness delta: >99=step 10, >49=step 5, else=step 1
- WiFi credentials stored in EEPROM bytes 0-63, brightness at 500, mode at 501
- Clock face overlap: clear-then-layer approach (hour→minute→second priority)
- WiFi provisioner sketch needed for lamp (writes EEPROM before DMA kills serial)
- Lamp COM port may change on USB replug (was COM3, became COM6)
