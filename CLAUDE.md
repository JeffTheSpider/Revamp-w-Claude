# Revamp w Claude - Project Instructions

## Overview
This workspace contains Charlie's hobby hardware projects being revamped with Claude's help.
Two main projects: a NeoPixel Clock and a Lamp, both ESP8266-based.

## Projects

### Clock ("Charlie's Mirror")
- **Hardware**: ESP8266 (NodeMCU), 60x NeoPixel LED ring, SSD1306 1.3" OLED display
- **Features**: NTP time sync, WiFi web server for config, multiple LED modes, brightness control
- **Location**: `Clock/`
- **Original code**: Scanned printouts in `Clock/Original Code/` (digitized to `clock_original.ino`)
- **Libraries**: Adafruit NeoPixel, Adafruit SSD1306, ESP8266WiFi, ESP8266WebServer, NTPClient, TimeLib, Timezone, EEPROM

### Lamp
- **Location**: `Lamp/`
- **Status**: Awaiting documentation from user
- **Built**: ~4-5 years ago with user's uncle

## Development Environment
- **OS**: Windows 11
- **Arduino CLI**: v1.4.1 (at ~/bin/arduino-cli.exe)
- **Board**: esp8266:esp8266:nodemcuv2 (ESP8266 NodeMCU)
- **Git**: Available
- **Node.js**: v24.13.1
- **Python**: 3.14

## Conventions
- Always use `arduino-cli` with `export PATH="$HOME/bin:$PATH"` prefix
- Board FQBN for clock: `esp8266:esp8266:nodemcuv2`
- Keep original code as reference; new code goes in separate directories
- Test compile before suggesting uploads to hardware
