#!/bin/bash
# OTA upload lamp firmware to lamp.local
export PATH="$HOME/bin:$PATH"
ESPOTA="C:/Users/charl/AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools/espota.py"
BIN="D:/Revamp w Claude/Lamp/lamp_v1/build/lamp_v1.ino.bin"

echo "Uploading to lamp.local (192.168.0.202)..."
cd "$(dirname "$ESPOTA")" && python3 espota.py -i 192.168.0.202 -p 8266 -P 48266 -f "$BIN" -d
