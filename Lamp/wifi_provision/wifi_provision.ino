// ============================================================
// WiFi Provisioner
// ============================================================
// Writes WiFi credentials to EEPROM for use by the lamp
// firmware. Run this ONCE, then flash the real firmware.
//
// Does NOT use NeoPixel/DMA so Serial stays alive.
// ============================================================

#include <ESP8266WiFi.h>
#include <EEPROM.h>

// Must match lamp_v1 config.h EEPROM layout
#define EEPROM_SIZE        512
#define EEPROM_SSID_LEN    0
#define EEPROM_PASS_LEN    1
#define EEPROM_SSID_START  2
#define EEPROM_BRIGHTNESS  500
#define EEPROM_MODE        501
#define EEPROM_MAGIC_H     510
#define EEPROM_MAGIC_L     511
#define EEPROM_MAGIC_VALUE 0x1A4B

// ===== EDIT THESE =====
const char* WIFI_SSID = "VM9388584";
const char* WIFI_PASS = "pfzt4fsc9prxgpDV";
// =======================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== WiFi Provisioner ===");

  // Write credentials to EEPROM
  int ssidLen = strlen(WIFI_SSID);
  int passLen = strlen(WIFI_PASS);

  Serial.printf("SSID: %s (%d chars)\n", WIFI_SSID, ssidLen);
  Serial.printf("Pass: %d chars\n", passLen);

  EEPROM.begin(EEPROM_SIZE);

  EEPROM.write(EEPROM_SSID_LEN, ssidLen);
  EEPROM.write(EEPROM_PASS_LEN, passLen);

  for (int i = 0; i < ssidLen; i++) {
    EEPROM.write(EEPROM_SSID_START + i, WIFI_SSID[i]);
  }
  for (int i = 0; i < passLen; i++) {
    EEPROM.write(EEPROM_SSID_START + ssidLen + i, WIFI_PASS[i]);
  }

  // Write default brightness and mode
  EEPROM.write(EEPROM_BRIGHTNESS, 30);
  EEPROM.write(EEPROM_MODE, 5);  // MODE_CANDLE

  // Write magic number
  EEPROM.write(EEPROM_MAGIC_H, (EEPROM_MAGIC_VALUE >> 8) & 0xFF);
  EEPROM.write(EEPROM_MAGIC_L, EEPROM_MAGIC_VALUE & 0xFF);

  EEPROM.commit();
  EEPROM.end();

  Serial.println("EEPROM written!");

  // Verify by connecting
  Serial.println("Testing WiFi connection...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi CONNECTED!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
    Serial.println("\nSUCCESS - Now flash the real lamp firmware!");
  } else {
    Serial.println("WiFi FAILED - check credentials");
  }
}

void loop() {
  // Nothing - just sit here
  delay(1000);
}
