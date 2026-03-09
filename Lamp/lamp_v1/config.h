#pragma once

// ============================================================
// Charlie's Lamp - Configuration
// ============================================================

// === Feature Flags ===
#define FEATURE_OTA        1
#define FEATURE_MDNS       1
#define FEATURE_SAFE_MODE  1
#define FEATURE_WATCHDOG   1
#define FEATURE_TELNET     1
#define FEATURE_NEOPIXEL   1

// === Pin Definitions ===
// Each of 4 LED strips is wired to a separate GPIO pin.
// BitBang method (DMA/I2S broken on this chip).
// GPIO0 doubles as FLASH button (safe mode trigger).
#define PIN_STRIP1       2   // GPIO2 (D4) - Strip 1 (top)
#define PIN_STRIP2       4   // GPIO4 (D2) - Strip 2
#define PIN_STRIP3       5   // GPIO5 (D1) - Strip 3
#define PIN_STRIP4       0   // GPIO0 (D3) - Strip 4 (bottom)
#define PIN_NEOPIXEL     2   // Alias for global pixel buffer (pin irrelevant for buffer)
#define PIN_FLASH_BTN    0   // GPIO0 (D3) - FLASH button (safe mode trigger)

// === NeoPixel Config ===
// 4 strips x 6 LEDs = 24 total, embedded under resin
#define PIXEL_COUNT        24
#define STRIPS             4
#define LEDS_PER_STRIP     6
#define DEFAULT_BRIGHTNESS 30

// === Network Config ===
#define HOSTNAME         "lamp"
#define OTA_PASSWORD     "lamp-ota"
#define AP_SSID          "Lamp"
#define AP_PASSWORD      "Livelong"
#define STATIC_IP_OCTET  202

// === Timing ===
#define WATCHDOG_TIMEOUT_S    30       // Reset if loop() stalls >30s

// === EEPROM Layout ===
#define EEPROM_SIZE        512
#define EEPROM_SSID_LEN    0    // byte 0: SSID length
#define EEPROM_PASS_LEN    1    // byte 1: password length
#define EEPROM_SSID_START  2    // bytes 2+: SSID chars
#define EEPROM_BRIGHTNESS  500  // byte 500: brightness
#define EEPROM_MODE        501  // byte 501: last mode
#define EEPROM_BOOT_COUNT  502  // byte 502: crash counter
#define EEPROM_CRASH_TYPE  503  // byte 503: last crash type
#define EEPROM_MAGIC_H     510  // byte 510: magic high byte
#define EEPROM_MAGIC_L     511  // byte 511: magic low byte
#define EEPROM_MAGIC_VALUE 0x1A4B  // Lamp magic number
