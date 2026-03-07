#include <EEPROM.h>

const int EEPROM_Size = 512;
String ssid = "VM9388584";
String password = "pfzt4fsc9prxgpDV";
int Brightness = 30;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== EEPROM WiFi Writer ===");

  EEPROM.begin(EEPROM_Size);

  // Write SSID length and password length
  EEPROM.write(0, ssid.length());
  EEPROM.write(1, password.length());

  // Write SSID characters starting at byte 2
  for (int n = 2; n < ssid.length() + 2; n++) {
    EEPROM.write(n, ssid[n - 2]);
  }

  // Write password characters after SSID
  for (int n = ssid.length() + 2; n < ssid.length() + 2 + password.length(); n++) {
    EEPROM.write(n, password[n - ssid.length() - 2]);
  }

  // Write brightness
  EEPROM.write(500, Brightness);

  EEPROM.commit();
  EEPROM.end();

  Serial.println("SSID: " + ssid + " (len=" + String(ssid.length()) + ")");
  Serial.println("Pass: " + password + " (len=" + String(password.length()) + ")");
  Serial.println("Brightness: " + String(Brightness));
  Serial.println("=== EEPROM Written OK ===");
}

void loop() {
  delay(1000);
}
