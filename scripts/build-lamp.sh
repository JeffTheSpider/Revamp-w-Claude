#!/bin/bash
# Build lamp firmware
export PATH="$HOME/bin:$PATH"
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 \
  --output-dir "D:/Revamp w Claude/Lamp/lamp_v1/build" \
  "D:/Revamp w Claude/Lamp/lamp_v1/"
