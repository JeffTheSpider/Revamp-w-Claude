# Hardware Notes - Revamp w Claude

## Common Architecture
Both devices were built by Charlie's uncle using identical MCU + LED driver architecture:
- **MCU**: ESP8266EX (NodeMCU LoLin v2 form factor)
- **LED Driver**: NeoPixelBus DMA method on GPIO3 (hardware I2S)
- **USB-Serial**: CH340 (conflicts with DMA on GPIO3)
- **Recovery**: Safe mode skips NeoPixel init, preserving USB serial

## Charlie's Mirror (Clock)

| Spec | Detail |
|------|--------|
| MCU | ESP8266EX, 4MB flash, 26MHz |
| MAC | 68:c6:3a:97:a5:4f |
| LEDs | 60x WS2812B ring |
| Dead LEDs | 0, 55-59 (6 dead), LED 54 degraded |
| Display | SSD1306 1.3" OLED (I2C @ 0x3c) |
| NeoPixel | GPIO3 (DMA) |
| OLED SDA | GPIO0 (D3) |
| OLED SCL | GPIO2 (D4) |
| FLASH btn | GPIO0 (shared with OLED SDA) |
| Power cap | 1000uF 25V |
| IP | 192.168.0.201 |
| mDNS | mirror.local |
| Firmware | v2.4.0, 358KB flash, 43KB RAM |

## Charlie's Lamp

| Spec | Detail |
|------|--------|
| MCU | ESP8266EX, 4MB flash, 26MHz |
| MAC | 68:c6:3a:97:4c:31 |
| LEDs | 24x WS2812B (4 strips x 6) |
| Dead LEDs | None |
| Display | None |
| NeoPixel | GPIO3 (DMA) |
| FLASH btn | GPIO0 (D3) |
| Physical | Wooden + resin lamp, wood-lathed |
| IP | 192.168.0.202 |
| mDNS | lamp.local |
| Firmware | v1.0.0, 365KB flash, 42KB RAM |

## GPIO3 DMA Notes
- ESP8266 NeoPixelBus DMA is **hardwired to GPIO3** (hardware I2S peripheral)
- GPIO3 is also the UART RX pin - DMA activation kills serial communication
- This is a hardware limitation, not configurable
- Safe mode (triggered by 3 crashes or FLASH button hold) skips NeoPixel init
- In safe mode, GPIO3 reverts to UART RX, enabling USB serial for recovery
- OTA updates work normally since they use WiFi, not serial

## Network Architecture
```
Router (192.168.0.1)
  |
  +-- PC (192.168.0.55) -- Hub server (port 3000)
  |
  +-- Clock (192.168.0.201) -- mirror.local
  |
  +-- Lamp (192.168.0.202) -- lamp.local
```

## USB Serial Notes
- Both devices use CH340 USB-serial chips
- COM port assignments can change on replug
- Always verify with `arduino-cli board list` before flashing
- DMA must not be active for serial communication
- Flash new firmware via USB: `arduino-cli upload -p COMX --fqbn esp8266:esp8266:nodemcuv2`
- Flash via OTA: `python3 espota.py -i <IP> -p 8266 -P 48266 -f <binary>`

## WiFi
- Home network: VM9388584 (case-sensitive!)
- Both devices use static IP with DHCP-then-override approach
- SoftAP fallback if WiFi connection fails
- WiFi credentials stored in EEPROM (bytes 0-63)
- Auto-reconnect every 30s if connection drops
