#pragma once

// ============================================================
// Charlie's Mirror - Configuration
// ============================================================

// === Feature Flags ===
#define FEATURE_OTA        1
#define FEATURE_MDNS       1
#define FEATURE_SAFE_MODE  1
#define FEATURE_WATCHDOG   1
#define FEATURE_TELNET     1  // Phase 2 - enabled
#define FEATURE_NEOPIXEL   1  // Phase 3 - enabled

// === Pin Definitions (original soldered wiring) ===
// Wires are soldered - cannot be moved
// NeoPixel uses DMA method (hardwired to GPIO3, hardware I2S)
// Serial disabled (DMA conflicts with RX). Telnet replaces it.
// Safe mode does NOT init NeoPixel, so USB recovery still works.
#define PIN_OLED_SDA     0   // GPIO0 (D3) - OLED SDA (soldered)
#define PIN_OLED_SCL     2   // GPIO2 (D4) - OLED SCL (soldered)
#define PIN_NEOPIXEL     3   // GPIO3 (RX) - NeoPixel data (soldered, DMA)
#define PIN_FLASH_BTN    0   // GPIO0 (D3) - FLASH button (shared with OLED SDA)

// === NeoPixel Config ===
#define PIXEL_COUNT      60
#define DEFAULT_BRIGHTNESS 30

// === Network Config ===
#define HOSTNAME         "mirror"
#define OTA_PASSWORD     "mirror-ota"
#define AP_SSID          "Mirror"
#define AP_PASSWORD      "Livelong"
#define STATIC_IP_OCTET  201

// === Timing ===
#define NTP_SERVER       "uk.pool.ntp.org"
#define NTP_SYNC_INTERVAL_MS  3600000  // 1 hour
#define WATCHDOG_TIMEOUT_S    30       // Reset if loop() stalls >30s

// === EEPROM Layout ===
#define EEPROM_SIZE        512
#define EEPROM_SSID_LEN    0    // byte 0: SSID length
#define EEPROM_PASS_LEN    1    // byte 1: password length
#define EEPROM_SSID_START  2    // bytes 2+: SSID chars
#define EEPROM_BRIGHTNESS  500  // byte 500: brightness
#define EEPROM_MODE        501  // byte 501: last mode (Phase 4)
#define EEPROM_BOOT_COUNT  502  // byte 502: crash counter (Phase 1)
#define EEPROM_CRASH_TYPE  503  // byte 503: last crash type (Phase 1)
#define EEPROM_MAGIC_H     510  // byte 510: magic high byte
#define EEPROM_MAGIC_L     511  // byte 511: magic low byte
#define EEPROM_MAGIC_VALUE 0xC10C
