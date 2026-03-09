#!/bin/bash
# Build clock firmware
export PATH="$HOME/bin:$PATH"
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 \
  --output-dir "D:/Revamp w Claude/Clock/clock_v2/build" \
  "D:/Revamp w Claude/Clock/clock_v2/"
