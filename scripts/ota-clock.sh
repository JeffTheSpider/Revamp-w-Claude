#!/bin/bash
# OTA upload clock firmware to mirror.local
export PATH="$HOME/bin:$PATH"
ESPOTA="C:/Users/charl/AppData/Local/Arduino15/packages/esp8266/hardware/esp8266/3.1.2/tools/espota.py"
BIN="D:/Revamp w Claude/Clock/clock_v2/build/clock_v2.ino.bin"

echo "Uploading to mirror.local (192.168.0.201)..."
cd "$(dirname "$ESPOTA")" && python3 espota.py -i 192.168.0.201 -p 8266 -P 48266 -f "$BIN" -d
