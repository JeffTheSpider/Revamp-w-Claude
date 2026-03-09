// ============================================================
// Charlie's Mirror v2.6.0 - Music Reactive
// ============================================================
// Complete firmware: OTA, safe mode, watchdog, telnet logging,
// NTP clock, 17 LED modes (incl. 3 music reactive), web dashboard.
//
// Hardware (soldered wiring - cannot change):
//   NeoPixel: GPIO3 (RX) via DMA/I2S - glitch-free, hardware-driven
//   OLED:     GPIO0 (SDA) / GPIO2 (SCL) - software I2C
//   FLASH:    GPIO0 (shared with OLED SDA) - safe mode trigger
//
// Serial is DISABLED (DMA conflicts with RX). Telnet replaces it.
// Safe mode skips NeoPixel init so USB recovery still works.
// ============================================================

#define FW_VERSION "2.6.0"

#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <ESP8266WebServer.h>
#include <ArduinoOTA.h>
#include <EEPROM.h>
#include <Wire.h>
#include <SSD1306.h>
#include <SSD1306Wire.h>
#include <Ticker.h>
#include <TelnetStream.h>
#include <NeoPixelBus.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <TimeLib.h>
#include <Timezone.h>
#include "config.h"

// === Globals ===
String ssid = "";
String password = "";
int Brightness = DEFAULT_BRIGHTNESS;
bool otaInProgress = false;
bool safeMode = false;
unsigned long bootTime = 0;
unsigned long lastStableTime = 0;
bool stabilityConfirmed = false;
uint8_t lastBootCount = 0;

// === OLED (GPIO0=SDA, GPIO2=SCL - software I2C) ===
SSD1306 display(0x3c, PIN_OLED_SDA, PIN_OLED_SCL);

// === Web Server ===
ESP8266WebServer server(80);

// === Watchdog ===
Ticker watchdogTicker;
volatile unsigned long lastLoopTime = 0;

// === Log Buffer (fixed-size char arrays to avoid heap fragmentation) ===
#define LOG_BUFFER_SIZE 30
#define LOG_LINE_MAX 120
char logBuffer[LOG_BUFFER_SIZE][LOG_LINE_MAX];
int logHead = 0;
int logCount = 0;

// === Forward declarations (needed by header files) ===
void logInfo(const String& msg);
void logWarn(const String& msg);
void logError(const String& msg);
void logDebug(const String& msg);
void displayText(const String& line1, const String& line2);

// === Music Reactive (UDP receiver) ===
WiFiUDP musicUdp;
const unsigned int MUSIC_UDP_PORT = 4210;
bool musicActive = false;
unsigned long lastMusicPacket = 0;
uint8_t musicBass = 0, musicMid = 0, musicTreble = 0;
bool musicBeat = false;
uint8_t musicBeatIntensity = 0;
uint8_t musicDominant = 0; // 0=bass, 1=mid, 2=treble

void tickMusicUdp() {
  int pktSize = musicUdp.parsePacket();
  if (pktSize < 8) return;
  uint8_t buf[8];
  if (musicUdp.read(buf, 8) < 8 || buf[0] != 0xBE) return;
  musicBass = buf[1]; musicMid = buf[2]; musicTreble = buf[3];
  musicBeat = (buf[4] == 0x01);
  musicBeatIntensity = buf[5];
  musicDominant = buf[6];
  lastMusicPacket = millis();
  musicActive = true;
}

void handleApiMusic() {
  char json[160];
  snprintf(json, sizeof(json),
    "{\"active\":%s,\"bass\":%d,\"mid\":%d,\"treble\":%d,"
    "\"beat\":%s,\"intensity\":%d,\"lastMs\":%lu}",
    musicActive ? "true" : "false",
    musicBass, musicMid, musicTreble,
    musicBeat ? "true" : "false", musicBeatIntensity,
    musicActive ? millis() - lastMusicPacket : 0UL);
  server.send(200, "application/json", json);
}

// === Include modular headers ===
#include "ntp_time.h"
#include "led_patterns.h"

// === NTP Sync Tracking ===
unsigned long lastNtpSync = 0;
int prevDisplaySec = -1;  // OLED update tracking

// === EEPROM Debounce ===
// Saves are deferred by 5s to avoid flash wear from rapid changes.
bool eepromDirty = false;
unsigned long eepromDirtyTime = 0;
#define EEPROM_SAVE_DELAY_MS 5000

// ============================================================
// Logging
// ============================================================
void logMsg(const String& level, const String& msg) {
  unsigned long t = millis() / 1000;
  snprintf(logBuffer[logHead], LOG_LINE_MAX, "[%lus] [%s] %s",
           t, level.c_str(), msg.c_str());

  TelnetStream.println(logBuffer[logHead]);

  logHead = (logHead + 1) % LOG_BUFFER_SIZE;
  if (logCount < LOG_BUFFER_SIZE) logCount++;
}

void logInfo(const String& msg)  { logMsg("INFO", msg); }
void logWarn(const String& msg)  { logMsg("WARN", msg); }
void logError(const String& msg) { logMsg("ERR", msg); }
void logDebug(const String& msg) { logMsg("DBG", msg); }

// ============================================================
// Watchdog
// ============================================================
void IRAM_ATTR watchdogCheck() {
  if (millis() - lastLoopTime > WATCHDOG_TIMEOUT_S * 1000UL) {
    ESP.restart();
  }
}

void watchdogFeed() { lastLoopTime = millis(); }

void watchdogStart() {
  lastLoopTime = millis();
  watchdogTicker.attach(5, watchdogCheck);
  logInfo("Watchdog started (" + String(WATCHDOG_TIMEOUT_S) + "s)");
}

void watchdogStop() { watchdogTicker.detach(); }

// ============================================================
// EEPROM
// ============================================================
void readEepromAll() {
  EEPROM.begin(EEPROM_SIZE);

  // WiFi credentials
  int ssidLen = EEPROM.read(EEPROM_SSID_LEN);
  int passLen = EEPROM.read(EEPROM_PASS_LEN);
  ssid = "";
  password = "";

  if (ssidLen <= 30 && passLen <= 30 && ssidLen > 0) {
    ssid.reserve(ssidLen);
    for (int n = 0; n < ssidLen; n++) {
      ssid += (char)EEPROM.read(EEPROM_SSID_START + n);
    }
    password.reserve(passLen);
    for (int n = 0; n < passLen; n++) {
      password += (char)EEPROM.read(EEPROM_SSID_START + ssidLen + n);
    }
  }

  // Brightness
  int storedBr = EEPROM.read(EEPROM_BRIGHTNESS);
  if (storedBr > 0 && storedBr < 251) {
    Brightness = storedBr;
  }

  // Saved mode (with magic number validation)
  uint8_t magicH = EEPROM.read(EEPROM_MAGIC_H);
  uint8_t magicL = EEPROM.read(EEPROM_MAGIC_L);
  uint16_t magic = (magicH << 8) | magicL;

  if (magic == EEPROM_MAGIC_VALUE) {
    uint8_t savedMode = EEPROM.read(EEPROM_MODE);
    if (savedMode < MODE_COUNT) {
      currentMode = (LedMode)savedMode;
      logInfo("Restored mode: " + String(MODE_LABELS[currentMode]));
    }
  } else {
    // First boot or corrupted EEPROM - write magic number
    EEPROM.write(EEPROM_MAGIC_H, (EEPROM_MAGIC_VALUE >> 8) & 0xFF);
    EEPROM.write(EEPROM_MAGIC_L, EEPROM_MAGIC_VALUE & 0xFF);
    EEPROM.write(EEPROM_MODE, MODE_CLOCK);
    EEPROM.commit();
    logInfo("EEPROM magic initialized");
  }

  EEPROM.end();
}

// Mark EEPROM as needing a write (debounced, see handleEepromSave)
void markEepromDirty() {
  eepromDirty = true;
  eepromDirtyTime = millis();
}

// Actually write brightness + mode to EEPROM (called after debounce delay)
void eepromFlush() {
  if (!eepromDirty) return;
  eepromDirty = false;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(EEPROM_BRIGHTNESS, Brightness);
  EEPROM.write(EEPROM_MODE, (uint8_t)currentMode);
  EEPROM.commit();
  EEPROM.end();
  logDebug("EEPROM saved (mode=" + String(MODE_IDS[currentMode]) + " br=" + String(Brightness) + ")");
}

// Save WiFi credentials to EEPROM
void saveWifiCredentials(const String& newSsid, const String& newPass) {
  if (newSsid.length() == 0 || newSsid.length() > 30 || newPass.length() > 30) return;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(EEPROM_SSID_LEN, newSsid.length());
  EEPROM.write(EEPROM_PASS_LEN, newPass.length());
  for (unsigned int n = 0; n < newSsid.length(); n++) {
    EEPROM.write(EEPROM_SSID_START + n, newSsid[n]);
  }
  for (unsigned int n = 0; n < newPass.length(); n++) {
    EEPROM.write(EEPROM_SSID_START + newSsid.length() + n, newPass[n]);
  }
  EEPROM.commit();
  EEPROM.end();
  ssid = newSsid;
  password = newPass;
  logInfo("WiFi credentials saved: " + newSsid);
}

// ============================================================
// Brightness Control
// ============================================================
// Adaptive delta: large steps at high brightness, fine at low.
void adjustBrightness(bool brighter) {
  int delta;
  if (Brightness > 99) delta = 10;
  else if (Brightness > 49) delta = 5;
  else delta = 1;

  if (brighter && Brightness < 241) Brightness += delta;
  else if (!brighter && Brightness > 1) Brightness -= delta;

  markEepromDirty();
  modeChanged = true;  // Force pattern redraw
  logInfo("Brightness: " + String(Brightness));
}

// ============================================================
// Crash Counter
// ============================================================
void crashCounterCheck() {
  EEPROM.begin(EEPROM_SIZE);
  uint8_t bootCount = EEPROM.read(EEPROM_BOOT_COUNT);
  if (bootCount > 10) bootCount = 0;
  lastBootCount = bootCount;

  if (bootCount >= 3) {
    safeMode = true;
    EEPROM.write(EEPROM_BOOT_COUNT, 0);
    EEPROM.commit();
    EEPROM.end();
    logWarn("Boot count was " + String(bootCount) + " (>=3), forcing safe mode");
  } else {
    EEPROM.write(EEPROM_BOOT_COUNT, bootCount + 1);
    EEPROM.commit();
    EEPROM.end();
    logInfo("Boot count: " + String(bootCount) + " -> " + String(bootCount + 1) + " (safe mode at 3)");
  }
}

void crashCounterClear() {
  if (stabilityConfirmed) return;
  stabilityConfirmed = true;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(EEPROM_BOOT_COUNT, 0);
  EEPROM.commit();
  EEPROM.end();
  logInfo("Stability confirmed, crash counter cleared");
}

// ============================================================
// Safe Mode
// ============================================================
void checkSafeMode() {
  pinMode(PIN_FLASH_BTN, INPUT);
  delay(100);
  if (digitalRead(PIN_FLASH_BTN) == LOW) {
    displayText("SAFE MODE?", "Keep holding...");
    delay(2000);
    if (digitalRead(PIN_FLASH_BTN) == LOW) {
      safeMode = true;
    }
  }
}

// ============================================================
// WiFi
// ============================================================
bool connectWiFi() {
  if (ssid.length() == 0) {
    logWarn("No SSID in EEPROM");
    return false;
  }

  logInfo("Connecting to: " + ssid);
  displayText("Connecting...", ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    yield();  // Feed soft WDT during blocking connect
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    // Capture gateway/subnet from completed DHCP before reconfiguring
    IPAddress gw = WiFi.gatewayIP();
    IPAddress sn = WiFi.subnetMask();
    IPAddress ip = WiFi.localIP();
    ip[3] = STATIC_IP_OCTET;
    WiFi.config(ip, gw, sn);
    delay(100);
    String ipStr = WiFi.localIP().toString();
    logInfo("WiFi connected: " + ipStr + " (" + String(WiFi.RSSI()) + " dBm)");
    return true;
  }

  logError("WiFi connection failed");
  return false;
}

void startSoftAP() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  logInfo("SoftAP: " + String(AP_SSID) + " @ " + WiFi.softAPIP().toString());
}

// ============================================================
// OTA
// ============================================================
void setupOTA() {
  ArduinoOTA.setHostname(HOSTNAME);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    watchdogStop();
    logInfo("OTA update starting...");
    displayText("OTA UPDATE", "DO NOT UNPLUG");
  });

  ArduinoOTA.onEnd([]() {
    otaInProgress = false;
    logInfo("OTA update complete!");
    displayText("OTA DONE", "Rebooting...");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    // Guard: total can be 0 at start; use multiply-first to avoid integer div-by-zero
    int pct = (total > 0) ? (int)((uint32_t)progress * 100 / total) : 0;
    display.clear();
    display.setTextAlignment(TEXT_ALIGN_CENTER);
    display.setFont(ArialMT_Plain_16);
    display.drawString(64, 0, "UPDATING");
    display.drawProgressBar(4, 28, 120, 12, pct);
    display.setFont(ArialMT_Plain_10);
    display.drawString(64, 48, String(pct) + "%");
    display.display();
  });

  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    watchdogStart();
    String errMsg;
    if (error == OTA_AUTH_ERROR) errMsg = "Auth Failed";
    else if (error == OTA_BEGIN_ERROR) errMsg = "Begin Failed";
    else if (error == OTA_CONNECT_ERROR) errMsg = "Connect Failed";
    else if (error == OTA_RECEIVE_ERROR) errMsg = "Receive Failed";
    else if (error == OTA_END_ERROR) errMsg = "End Failed";
    logError("OTA error: " + errMsg);
    displayText("OTA ERROR", errMsg);
  });

  ArduinoOTA.begin();
  logInfo("OTA ready");
}

// ============================================================
// OLED Display
// ============================================================
void displayText(const String& line1, const String& line2) {
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);
  display.setFont(ArialMT_Plain_16);
  display.drawString(64, 8, line1);
  display.setFont(ArialMT_Plain_10);
  display.drawString(64, 32, line2);
  display.display();
}

void displaySafeMode() {
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);
  display.setFont(ArialMT_Plain_16);
  display.drawString(64, 0, "SAFE MODE");
  display.setFont(ArialMT_Plain_10);
  display.drawString(64, 20, WiFi.localIP().toString());
  display.drawString(64, 34, "OTA: Ready");
  display.drawString(64, 48, "Heap: " + String(ESP.getFreeHeap()));
  display.display();
}

// Show time and date on OLED (clock mode)
void displayClockFace() {
  if (!isTimeValid()) return;
  updateTimeStrings();

  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);
  display.setFont(ArialMT_Plain_24);
  display.drawStringMaxWidth(64, 11, 128, timeStr);
  display.setFont(ArialMT_Plain_10);
  display.drawStringMaxWidth(64, 38, 128, dateStr);
  display.setFont(ArialMT_Plain_16);
  display.drawString(10, 0, secondStr);
  display.display();
}

// Show mode name and brightness on OLED (non-clock modes)
void displayModeInfo() {
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);
  display.setFont(ArialMT_Plain_16);
  display.drawString(64, 0, MODE_LABELS[currentMode]);
  display.setFont(ArialMT_Plain_10);
  display.drawString(64, 22, "Brightness: " + String(Brightness));
  if (isTimeValid()) {
    updateTimeStrings();
    display.drawString(64, 36, timeStr);
  }
  display.drawString(64, 50, WiFi.localIP().toString());
  display.display();
}

// ============================================================
// LED Startup Test
// ============================================================
void ledStartupTest() {
  if (safeMode) return;

  logInfo("LED startup test...");
  strip.Begin();
  strip.Show();

  // RGB chase
  RgbColor colors[] = {
    RgbColor(Brightness, 0, 0),
    RgbColor(0, Brightness, 0),
    RgbColor(0, 0, Brightness)
  };

  for (int c = 0; c < 3; c++) {
    for (int i = 0; i < PIXEL_COUNT; i++) {
      strip.SetPixelColor(i, colors[c]);
      strip.Show();
      delay(8);
      strip.SetPixelColor(i, RgbColor(0));
    }
  }

  // Brief white flash
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, RgbColor(Brightness));
  }
  strip.Show();
  delay(200);

  // Clear
  clearAll();
  logInfo("LED test complete");
}

// ============================================================
// Web Server - Helpers
// ============================================================
String formatUptime(unsigned long uptime) {
  if (uptime > 86400) return String(uptime / 86400) + "d " + String((uptime % 86400) / 3600) + "h";
  if (uptime > 3600) return String(uptime / 3600) + "h " + String((uptime % 3600) / 60) + "m";
  if (uptime > 60) return String(uptime / 60) + "m " + String(uptime % 60) + "s";
  return String(uptime) + "s";
}

// ============================================================
// Web Server - Dashboard (GET /)
// ============================================================
void handleDashboard() {
  unsigned long uptime = (millis() - bootTime) / 1000;

  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/html", "");

  // Head
  server.sendContent("<!DOCTYPE html><html><head>");
  server.sendContent("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  server.sendContent("<title>Charlie's Mirror</title>");
  server.sendContent("<style>");
  server.sendContent("*{box-sizing:border-box}");
  server.sendContent("body{font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#1a1a2e;color:#e0e0e0;}");
  server.sendContent("h1{color:#00d4ff;text-align:center;margin:8px 0}");
  server.sendContent("h2{color:#00d4ff;font-size:14px;margin:0 0 8px}");
  server.sendContent(".card{background:#16213e;border-radius:8px;padding:14px;margin:10px 0}");
  server.sendContent(".ok{color:#00ff88}.warn{color:#ffaa00}.err{color:#ff4444}");
  server.sendContent(".label{color:#888;font-size:13px}");
  server.sendContent("a{color:#00d4ff}");
  server.sendContent(".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}");
  server.sendContent(".mbtn{display:block;background:#0a3d62;color:#e0e0e0;padding:10px 4px;");
  server.sendContent("border-radius:6px;text-decoration:none;text-align:center;font-size:13px;border:2px solid transparent}");
  server.sendContent(".mbtn:hover{background:#0066cc}.mbtn.act{border-color:#00d4ff;background:#0066cc}");
  server.sendContent(".bbtn{display:inline-block;background:#0a3d62;color:white;padding:8px 20px;");
  server.sendContent("border-radius:4px;text-decoration:none;margin:2px;font-size:16px}");
  server.sendContent(".bbtn:hover{background:#0066cc}");
  server.sendContent(".btn{display:inline-block;background:#0066cc;color:white;padding:6px 14px;");
  server.sendContent("border-radius:4px;text-decoration:none;margin:3px;font-size:13px}");
  server.sendContent(".btn:hover{background:#0088ff}");
  server.sendContent("</style></head><body>");

  // Title
  server.sendContent("<h1>Charlie's Mirror</h1>");

  // Safe mode warning
  if (safeMode) {
    server.sendContent("<div class='card' style='border:2px solid #ffaa00'>");
    server.sendContent("<b class='warn'>SAFE MODE ACTIVE</b> - NeoPixel disabled, OTA available.</div>");
  }

  // Time display (if valid)
  if (isTimeValid() && !safeMode) {
    server.sendContent("<div class='card' style='text-align:center'>");
    server.sendContent(String("<span style='font-size:28px;color:#00d4ff'>") + timeStr + "</span>");
    server.sendContent(String("<br><span class='label'>") + dateStr + "</span></div>");
  }

  // Mode selection
  if (!safeMode) {
    server.sendContent("<div class='card'><h2>LED Mode</h2>");
    server.sendContent("<div class='grid'>");
    for (int i = 0; i < MODE_COUNT; i++) {
      String cls = (i == currentMode) ? "mbtn act" : "mbtn";
      server.sendContent("<a class='" + cls + "' href='/api/pattern?id=" +
                         String(MODE_IDS[i]) + "'>" + String(MODE_LABELS[i]) + "</a>");
    }
    server.sendContent("</div></div>");

    // Brightness control
    server.sendContent("<div class='card'><h2>Brightness: " + String(Brightness) + "</h2>");
    server.sendContent("<div style='text-align:center'>");
    server.sendContent("<a class='bbtn' href='/api/brightness?dir=down'>-</a>");
    server.sendContent(" <span style='display:inline-block;width:60px;text-align:center;font-size:20px'>" + String(Brightness) + "</span> ");
    server.sendContent("<a class='bbtn' href='/api/brightness?dir=up'>+</a>");
    server.sendContent("</div></div>");
  }

  // System status
  server.sendContent("<div class='card'><h2>System</h2>");
  server.sendContent("<span class='label'>Version:</span> v" + String(FW_VERSION) + "<br>");
  server.sendContent("<span class='label'>Mode:</span> ");
  server.sendContent(safeMode ? "<span class='warn'>Safe Mode</span>" : "<span class='ok'>" + String(MODE_LABELS[currentMode]) + "</span>");
  server.sendContent("<br><span class='label'>WiFi:</span> ");
  if (WiFi.status() == WL_CONNECTED) {
    server.sendContent("<span class='ok'>Connected</span> (" + WiFi.localIP().toString() + ", " + String(WiFi.RSSI()) + " dBm)<br>");
  } else {
    server.sendContent("<span class='warn'>Disconnected</span><br>");
  }
  server.sendContent("<span class='label'>Uptime:</span> " + formatUptime(uptime) + "<br>");
  server.sendContent("<span class='label'>Heap:</span> " + String(ESP.getFreeHeap()) + " bytes<br>");
  server.sendContent("<span class='label'>NTP:</span> ");
  server.sendContent(isTimeValid() ? "<span class='ok'>Synced</span>" : "<span class='warn'>Not synced</span>");
  server.sendContent("<br><span class='label'>NeoPixel:</span> ");
  server.sendContent(safeMode ? "<span class='warn'>Disabled</span>" : "<span class='ok'>DMA GPIO3</span>");
  server.sendContent("</div>");

  // Actions
  server.sendContent("<div class='card'><h2>Actions</h2>");
  server.sendContent("<a class='btn' href='/led?test=1'>LED Test</a>");
  server.sendContent("<a class='btn' href='/wifi'>WiFi Config</a>");
  server.sendContent("<a class='btn' href='/log'>Logs</a>");
  server.sendContent("<a class='btn' href='/api/status'>API Status</a>");
  server.sendContent("<a class='btn' href='/api/patterns'>API Patterns</a>");
  server.sendContent("<a class='btn' href='/restart'>Restart</a>");
  server.sendContent("</div>");

  // Telnet
  server.sendContent("<div class='card'><h2>Telnet</h2>");
  server.sendContent("<code style='color:#00d4ff'>telnet " + String(HOSTNAME) + ".local</code></div>");

  // Footer
  server.sendContent("<p style='text-align:center;color:#555;font-size:11px'>v" + String(FW_VERSION) + " | DMA NeoPixel | " + String(PIXEL_COUNT) + " LEDs</p>");
  server.sendContent("</body></html>");
  server.sendContent("");
}

// ============================================================
// Web Server - JSON Status (GET /api/status)
// ============================================================
void handleApiStatus() {
  unsigned long uptime = (millis() - bootTime) / 1000;
  // Store IP string before snprintf to avoid dangling pointer
  // (WiFi.localIP().toString() returns a temporary String)
  String ipStr = WiFi.localIP().toString();
  char json[560];
  snprintf(json, sizeof(json),
    "{\"device\":\"mirror\","
    "\"version\":\"%s\","
    "\"safeMode\":%s,"
    "\"uptime\":%lu,"
    "\"freeHeap\":%u,"
    "\"wifiConnected\":%s,"
    "\"rssi\":%d,"
    "\"ip\":\"%s\","
    "\"mode\":\"%s\","
    "\"modeName\":\"%s\","
    "\"brightness\":%d,"
    "\"color\":{\"r\":%d,\"g\":%d,\"b\":%d},"
    "\"neopixel\":\"DMA_GPIO3\","
    "\"oled\":\"I2C_GPIO0_GPIO2\","
    "\"ntpValid\":%s,"
    "\"bootCount\":%d,"
    "\"stable\":%s,"
    "\"capabilities\":[\"color\",\"ntp\",\"oled\",\"patterns\",\"music\"]}",
    FW_VERSION,
    safeMode ? "true" : "false",
    uptime,
    ESP.getFreeHeap(),
    WiFi.status() == WL_CONNECTED ? "true" : "false",
    WiFi.RSSI(),
    ipStr.c_str(),
    MODE_IDS[currentMode],
    MODE_LABELS[currentMode],
    Brightness,
    customR, customG, customB,
    isTimeValid() ? "true" : "false",
    lastBootCount,
    stabilityConfirmed ? "true" : "false");
  server.send(200, "application/json", json);
}

// ============================================================
// Web Server - Pattern List (GET /api/patterns)
// ============================================================
void handleApiPatterns() {
  // 14 modes * ~40 chars each + brackets = ~570 chars max
  char json[640];
  int pos = 0;
  json[pos++] = '[';
  for (int i = 0; i < MODE_COUNT; i++) {
    if (i > 0) json[pos++] = ',';
    pos += snprintf(json + pos, sizeof(json) - pos,
      "{\"id\":\"%s\",\"name\":\"%s\"}", MODE_IDS[i], MODE_LABELS[i]);
  }
  json[pos++] = ']';
  json[pos] = '\0';
  server.send(200, "application/json", json);
}

// ============================================================
// Web Server - Set Pattern (GET /api/pattern?id=xxx)
// ============================================================
void handleApiPattern() {
  if (safeMode) {
    server.send(200, "text/plain", "LEDs disabled in safe mode");
    return;
  }

  if (server.hasArg("id")) {
    String id = server.arg("id");
    LedMode newMode = modeFromId(id);

    // Custom color: accept r, g, b query params
    if (newMode == MODE_COLOR && server.hasArg("r")) {
      uint8_t r = (uint8_t)server.arg("r").toInt();
      uint8_t g = server.hasArg("g") ? (uint8_t)server.arg("g").toInt() : 0;
      uint8_t b = server.hasArg("b") ? (uint8_t)server.arg("b").toInt() : 0;
      setCustomColor(r, g, b);
    }

    setMode(newMode);
    markEepromDirty();
  }

  // Return JSON for API callers, redirect for browser
  if (server.hasHeader("Accept") &&
      server.header("Accept").indexOf("json") >= 0) {
    server.send(200, "application/json", "{\"ok\":true}");
  } else {
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "");
  }
}

// ============================================================
// Web Server - Brightness (GET /api/brightness?dir=up|down|val=N)
// ============================================================
void handleApiBrightness() {
  if (server.hasArg("dir")) {
    adjustBrightness(server.arg("dir") == "up");
  } else if (server.hasArg("val")) {
    int v = server.arg("val").toInt();
    if (v >= 1 && v <= 250) {
      Brightness = v;
      markEepromDirty();
      modeChanged = true;
      logInfo("Brightness set: " + String(Brightness));
    }
  }

  server.sendHeader("Location", "/");
  server.send(302, "text/plain", "");
}

// ============================================================
// Web Server - Set Color (POST /api/color?r=X&g=X&b=X)
// ============================================================
// Shorthand for color mode + custom RGB (used by Hub color picker)
void handleApiColor() {
  if (safeMode) {
    server.send(200, "application/json", "{\"ok\":false,\"reason\":\"safe mode\"}");
    return;
  }

  uint8_t r = server.hasArg("r") ? (uint8_t)server.arg("r").toInt() : 0;
  uint8_t g = server.hasArg("g") ? (uint8_t)server.arg("g").toInt() : 0;
  uint8_t b = server.hasArg("b") ? (uint8_t)server.arg("b").toInt() : 0;
  setCustomColor(r, g, b);
  setMode(MODE_COLOR);
  server.send(200, "application/json", "{\"ok\":true}");
}

// ============================================================
// Web Server - LED Test (GET /led?test=1)
// ============================================================
void handleLed() {
  if (safeMode) {
    server.send(200, "text/plain", "LEDs disabled in safe mode");
    return;
  }

  if (server.hasArg("test")) {
    logInfo("LED test triggered via web");
    ledStartupTest();
    modeChanged = true;  // Redraw current pattern after test
  }

  server.sendHeader("Location", "/");
  server.send(302, "text/plain", "");
}

// ============================================================
// Web Server - Logs (GET /log)
// ============================================================
void handleLog() {
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/html", "");

  server.sendContent("<!DOCTYPE html><html><head>");
  server.sendContent("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  server.sendContent("<meta http-equiv='refresh' content='5'>");
  server.sendContent("<title>Mirror Logs</title>");
  server.sendContent("<style>body{font-family:monospace;max-width:800px;margin:0 auto;padding:20px;");
  server.sendContent("background:#0d1117;color:#c9d1d9;}");
  server.sendContent("h1{color:#00d4ff}pre{white-space:pre-wrap;font-size:13px;line-height:1.6}");
  server.sendContent(".info{color:#58a6ff}.warn{color:#d29922}.err{color:#f85149}.dbg{color:#8b949e}");
  server.sendContent("a{color:#00d4ff}</style></head><body>");
  server.sendContent("<h1>Mirror Logs</h1>");
  server.sendContent("<p style='color:#8b949e'>Auto-refresh 5s | <a href='/'>Dashboard</a></p><pre>");

  if (logCount > 0) {
    int start = (logCount < LOG_BUFFER_SIZE) ? 0 : logHead;
    int count = (logCount < LOG_BUFFER_SIZE) ? logCount : LOG_BUFFER_SIZE;
    for (int i = 0; i < count; i++) {
      int idx = (start + i) % LOG_BUFFER_SIZE;
      const char* line = logBuffer[idx];
      const char* cls = "info";
      if (strstr(line, "[ERR]")) cls = "err";
      else if (strstr(line, "[WARN]")) cls = "warn";
      else if (strstr(line, "[DBG]")) cls = "dbg";
      server.sendContent("<span class='" + String(cls) + "'>");
      // HTML-escape the log line to prevent XSS
      String safe = String(line);
      safe.replace("&", "&amp;");
      safe.replace("<", "&lt;");
      safe.replace(">", "&gt;");
      server.sendContent(safe + "</span>\n");
    }
  } else {
    server.sendContent("No log entries yet.\n");
  }

  server.sendContent("</pre><p style='color:#8b949e;font-size:11px'>Heap: " + String(ESP.getFreeHeap()) + "</p>");
  server.sendContent("</body></html>");
  server.sendContent("");
}

// ============================================================
// Web Server - WiFi Scan (GET /api/wifi/scan)
// ============================================================
void handleApiWifiScan() {
  int n = WiFi.scanNetworks();

  // Stream response to avoid large String allocation
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  server.sendContent("[");
  for (int i = 0; i < n; i++) {
    if (i > 0) server.sendContent(",");
    // Escape quotes/backslashes in SSID for valid JSON
    String safeSsid = WiFi.SSID(i);
    safeSsid.replace("\\", "\\\\");
    safeSsid.replace("\"", "\\\"");
    // Buffer: 64 chars for escaped SSID + ~40 chars JSON overhead = ~104 max
    char entry[160];
    snprintf(entry, sizeof(entry), "{\"ssid\":\"%s\",\"rssi\":%d,\"enc\":%s}",
             safeSsid.c_str(), WiFi.RSSI(i),
             WiFi.encryptionType(i) != ENC_TYPE_NONE ? "true" : "false");
    server.sendContent(entry);
  }
  server.sendContent("]");
  server.sendContent("");
  WiFi.scanDelete();
}

// ============================================================
// Web Server - WiFi Config (POST /api/wifi/config)
// ============================================================
void handleApiWifiConfig() {
  if (!server.hasArg("ssid")) {
    server.send(400, "text/plain", "Missing ssid parameter");
    return;
  }
  String newSsid = server.arg("ssid");
  String newPass = server.hasArg("pass") ? server.arg("pass") : "";
  saveWifiCredentials(newSsid, newPass);
  server.send(200, "text/plain", "WiFi credentials saved. Restarting...");
  delay(500);
  ESP.restart();
}

// ============================================================
// Web Server - WiFi Config Page (GET /wifi)
// ============================================================
void handleWifiPage() {
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/html", "");
  server.sendContent("<!DOCTYPE html><html><head>");
  server.sendContent("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  server.sendContent("<title>WiFi Config</title>");
  server.sendContent("<style>");
  server.sendContent("body{font-family:sans-serif;max-width:400px;margin:0 auto;padding:16px;background:#1a1a2e;color:#e0e0e0}");
  server.sendContent("h1{color:#00d4ff;text-align:center}");
  server.sendContent(".card{background:#16213e;border-radius:8px;padding:14px;margin:10px 0}");
  server.sendContent("input,select{width:100%;padding:8px;margin:6px 0;border-radius:4px;border:1px solid #444;background:#0d1117;color:#e0e0e0;box-sizing:border-box}");
  server.sendContent("button{width:100%;padding:10px;margin:6px 0;border:none;border-radius:4px;cursor:pointer;font-size:14px}");
  server.sendContent(".scan{background:#0a3d62;color:white}.save{background:#0066cc;color:white}");
  server.sendContent(".scan:hover{background:#0066cc}.save:hover{background:#0088ff}");
  server.sendContent("a{color:#00d4ff}.msg{color:#00ff88;margin:8px 0}");
  server.sendContent("</style></head><body>");
  server.sendContent("<h1>WiFi Config</h1>");
  server.sendContent("<div class='card'>");
  server.sendContent("<label>Current: <b>" + ssid + "</b></label>");
  server.sendContent("<button class='scan' onclick='doScan()'>Scan Networks</button>");
  server.sendContent("<select id='nets'><option>Click Scan first</option></select>");
  server.sendContent("<input id='ssid' placeholder='SSID'>");
  server.sendContent("<input id='pass' type='password' placeholder='Password'>");
  server.sendContent("<button class='save' onclick='doSave()'>Save &amp; Restart</button>");
  server.sendContent("<div id='msg'></div>");
  server.sendContent("</div>");
  server.sendContent("<div class='card'><a href='/'>Back to Dashboard</a></div>");
  server.sendContent("<script>");
  // Use safe DOM methods: createElement + textContent instead of innerHTML
  server.sendContent("function doScan(){");
  server.sendContent("var m=document.getElementById('msg');m.textContent='Scanning...';");
  server.sendContent("fetch('/api/wifi/scan').then(function(r){return r.json()}).then(function(d){");
  server.sendContent("var s=document.getElementById('nets');");
  server.sendContent("while(s.firstChild)s.removeChild(s.firstChild);");
  server.sendContent("d.forEach(function(n){var o=document.createElement('option');");
  server.sendContent("o.value=n.ssid;o.textContent=n.ssid+' ('+n.rssi+'dBm)';s.appendChild(o)});");
  server.sendContent("s.onchange=function(){document.getElementById('ssid').value=s.value};");
  server.sendContent("if(d.length>0)document.getElementById('ssid').value=d[0].ssid;");
  server.sendContent("m.textContent='Found '+d.length+' networks'");
  server.sendContent("}).catch(function(e){m.textContent='Scan failed'})}");
  server.sendContent("function doSave(){");
  server.sendContent("var ss=document.getElementById('ssid').value;");
  server.sendContent("var pp=document.getElementById('pass').value;");
  server.sendContent("if(!ss){document.getElementById('msg').textContent='Enter SSID';return}");
  server.sendContent("fetch('/api/wifi/config?ssid='+encodeURIComponent(ss)+'&pass='+encodeURIComponent(pp))");
  server.sendContent(".then(function(){document.getElementById('msg').textContent='Saved! Restarting...'})");
  server.sendContent(".catch(function(){document.getElementById('msg').textContent='Error'})}");
  server.sendContent("</script>");
  server.sendContent("</body></html>");
  server.sendContent("");
}

// ============================================================
// Web Server - Safe Mode (GET /api/safemode)
// ============================================================
void handleApiSafeMode() {
  logWarn("Safe mode requested via API");
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(EEPROM_BOOT_COUNT, 3);
  EEPROM.commit();
  EEPROM.end();
  server.send(200, "application/json",
    "{\"ok\":true,\"action\":\"safe_mode_armed\","
    "\"message\":\"Restarting into safe mode...\"}");
  delay(500);
  ESP.restart();
}

// ============================================================
// Web Server - Restart (GET /restart)
// ============================================================
void handleRestart() {
  logWarn("Restart requested via web");
  server.send(200, "text/html",
    "<html><body style='background:#1a1a2e;color:#e0e0e0;text-align:center;padding:50px'>"
    "<h2>Restarting...</h2>"
    "<script>setTimeout(()=>window.location='/',10000)</script>"
    "</body></html>");
  delay(500);
  ESP.restart();
}

// ============================================================
// Telnet Commands
// ============================================================
void handleTelnet() {
  if (!TelnetStream.available()) return;

  String cmd = "";
  while (TelnetStream.available()) {
    char c = TelnetStream.read();
    if (c == '\n' || c == '\r') break;
    cmd += c;
  }
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd == "status") {
    TelnetStream.println("=== Mirror Status ===");
    TelnetStream.println("Version: " + String(FW_VERSION));
    TelnetStream.println("Safe mode: " + String(safeMode ? "YES" : "no"));
    TelnetStream.println("Mode: " + String(MODE_LABELS[currentMode]));
    TelnetStream.println("Brightness: " + String(Brightness));
    TelnetStream.println("Uptime: " + formatUptime((millis() - bootTime) / 1000));
    TelnetStream.println("Free heap: " + String(ESP.getFreeHeap()));
    TelnetStream.println("WiFi: " + WiFi.localIP().toString() + " (" + String(WiFi.RSSI()) + " dBm)");
    TelnetStream.println("NTP: " + String(isTimeValid() ? "synced" : "not synced"));
    if (isTimeValid()) {
      TelnetStream.println(String("Time: ") + timeStr + " " + dateStr);
    }
    TelnetStream.println("NeoPixel: DMA GPIO3");
    TelnetStream.println("OLED: I2C GPIO0/GPIO2");

  } else if (cmd.startsWith("mode ")) {
    String modeId = cmd.substring(5);
    LedMode m = modeFromId(modeId);
    setMode(m);
    markEepromDirty();
    TelnetStream.println("Mode set: " + String(MODE_LABELS[m]));

  } else if (cmd == "modes") {
    TelnetStream.println("Available modes:");
    for (int i = 0; i < MODE_COUNT; i++) {
      String marker = (i == currentMode) ? " <-- active" : "";
      TelnetStream.println("  " + String(MODE_IDS[i]) + " (" + String(MODE_LABELS[i]) + ")" + marker);
    }

  } else if (cmd == "bright+" || cmd == "b+") {
    adjustBrightness(true);
    TelnetStream.println("Brightness: " + String(Brightness));

  } else if (cmd == "bright-" || cmd == "b-") {
    adjustBrightness(false);
    TelnetStream.println("Brightness: " + String(Brightness));

  } else if (cmd == "restart") {
    TelnetStream.println("Restarting...");
    delay(200);
    ESP.restart();

  } else if (cmd == "heap") {
    TelnetStream.println("Free heap: " + String(ESP.getFreeHeap()));

  } else if (cmd == "led test") {
    TelnetStream.println("Running LED test...");
    ledStartupTest();
    modeChanged = true;

  } else if (cmd == "ntp") {
    TelnetStream.println("Forcing NTP sync...");
    ntpSync();

  } else if (cmd == "help") {
    TelnetStream.println("Commands:");
    TelnetStream.println("  status     - System status");
    TelnetStream.println("  modes      - List LED modes");
    TelnetStream.println("  mode <id>  - Set LED mode");
    TelnetStream.println("  b+ / b-    - Adjust brightness");
    TelnetStream.println("  led test   - Run LED test");
    TelnetStream.println("  ntp        - Force NTP sync");
    TelnetStream.println("  heap       - Show free heap");
    TelnetStream.println("  restart    - Restart device");

  } else {
    TelnetStream.println("Unknown: " + cmd + " (type 'help')");
  }
}

// ============================================================
// NTP Sync Schedule
// ============================================================
void handleNtpSync() {
  unsigned long now = millis();

  // First sync after WiFi connects
  if (lastNtpSync == 0 && WiFi.status() == WL_CONNECTED) {
    if (ntpSync()) {
      lastNtpSync = now;
    }
    return;
  }

  // Retry every 10s if time not valid yet
  if (!isTimeValid() && WiFi.status() == WL_CONNECTED) {
    if (now - lastNtpSync > 10000) {
      ntpSync();
      lastNtpSync = now;  // Update regardless to avoid hammering
    }
    return;
  }

  // Hourly resync
  if (now - lastNtpSync > NTP_SYNC_INTERVAL_MS) {
    ntpSync();
    lastNtpSync = now;
  }
}

// ============================================================
// OLED Update (once per second)
// ============================================================
void handleOledUpdate() {
  int s = second();
  if (s == prevDisplaySec) return;
  prevDisplaySec = s;

  if (currentMode == MODE_CLOCK) {
    displayClockFace();
  } else {
    // Update mode display every 5 seconds to reduce flicker
    if (s % 5 == 0) {
      displayModeInfo();
    }
  }
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  bootTime = millis();
  delay(500);

  // OLED init (GPIO0=SDA, GPIO2=SCL - software I2C)
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  display.init();
  display.flipScreenVertically();
  displayText("Mirror v2", "Booting...");

  // Safe mode check (FLASH button held for 2s)
  checkSafeMode();

  // Read WiFi creds, brightness, saved mode from EEPROM
  readEepromAll();

  // Crash counter
  crashCounterCheck();

  if (safeMode) {
    displayText("SAFE MODE", "WiFi + OTA only");
  }

  // Network
  startSoftAP();
  bool wifiOk = connectWiFi();

  // Telnet
  TelnetStream.begin();
  logInfo("Telnet started on port 23");

  // OTA (also registers mDNS hostname)
  setupOTA();

  // Add HTTP service to mDNS for Hub auto-discovery
  MDNS.addService("http", "tcp", 80);

  // NTP (start client, first sync happens in loop)
  if (wifiOk) {
    ntpBegin();
  }

  // Music UDP listener
  musicUdp.begin(MUSIC_UDP_PORT);
  logInfo("Music UDP on port " + String(MUSIC_UDP_PORT));

  // NeoPixel (skip in safe mode to preserve USB recovery)
  if (!safeMode) {
    strip.Begin();
    strip.Show();
    logInfo("NeoPixel: DMA GPIO3, " + String(PIXEL_COUNT) + " LEDs (all active)");
    ledStartupTest();
  } else {
    logWarn("NeoPixel SKIPPED (safe mode)");
  }

  // Web server routes
  server.on("/", handleDashboard);
  server.on("/api/status", handleApiStatus);
  server.on("/status", handleApiStatus);           // backward compat
  server.on("/api/patterns", handleApiPatterns);
  server.on("/api/pattern", handleApiPattern);
  server.on("/api/brightness", handleApiBrightness);
  server.on("/api/color", handleApiColor);
  server.on("/log", handleLog);
  server.on("/led", handleLed);
  server.on("/wifi", handleWifiPage);
  server.on("/api/wifi/scan", handleApiWifiScan);
  server.on("/api/wifi/config", handleApiWifiConfig);
  server.on("/api/safemode", handleApiSafeMode);
  server.on("/api/music", handleApiMusic);
  server.on("/restart", handleRestart);
  server.onNotFound(handleDashboard);
  server.begin();
  logInfo("Web server started on port 80");

  // Watchdog
  watchdogStart();
  lastStableTime = millis();

  // Boot complete display
  if (safeMode) {
    displaySafeMode();
  } else if (wifiOk) {
    displayText("Mirror v2", WiFi.localIP().toString());
  } else {
    displayText("AP Mode", "Mirror");
  }

  logInfo("Boot OK. Mode=" + String(MODE_LABELS[currentMode]) +
          " Br=" + String(Brightness) + " Heap=" + String(ESP.getFreeHeap()));
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  watchdogFeed();

  // Core services
  ArduinoOTA.handle();
  server.handleClient();
  MDNS.update();
  handleTelnet();

  // NTP sync schedule
  handleNtpSync();

  // Music UDP data (non-blocking check)
  tickMusicUdp();
  if (musicActive && millis() - lastMusicPacket > 3000) {
    musicActive = false;
    musicBass = 0; musicMid = 0; musicTreble = 0; musicBeat = false;
  }

  // LED patterns + OLED update (skip during OTA or safe mode)
  if (!safeMode && !otaInProgress) {
    tickPatterns(Brightness);
    handleOledUpdate();
  }

  // Debounced EEPROM save (5s after last change)
  if (eepromDirty && (millis() - eepromDirtyTime > EEPROM_SAVE_DELAY_MS)) {
    eepromFlush();
  }

  // Stability check (clear crash counter after 30s)
  if (!stabilityConfirmed && (millis() - lastStableTime > 30000)) {
    crashCounterClear();
  }

  // WiFi reconnect (check every 30s, reconnect if disconnected)
  // Skip if WL_IDLE_STATUS (connection attempt already in progress)
  static unsigned long lastWifiCheck = 0;
  static bool wasDisconnected = false;
  if (millis() - lastWifiCheck > 30000) {
    lastWifiCheck = millis();
    wl_status_t wifiStatus = WiFi.status();
    if (wifiStatus != WL_CONNECTED && wifiStatus != WL_IDLE_STATUS && ssid.length() > 0) {
      logWarn("WiFi disconnected, reconnecting...");
      WiFi.begin(ssid.c_str(), password.c_str());
      wasDisconnected = true;
    } else if (wifiStatus == WL_CONNECTED && wasDisconnected) {
      // Re-sync NTP after WiFi reconnect
      wasDisconnected = false;
      logInfo("WiFi reconnected, re-syncing NTP...");
      ntpSync();
    }
  }

  // Periodic status log (every 5 minutes)
  static unsigned long lastStatusLog = 0;
  if (millis() - lastStatusLog > 300000) {
    logDebug("Heap=" + String(ESP.getFreeHeap()) +
             " RSSI=" + String(WiFi.RSSI()) +
             " Up=" + formatUptime((millis() - bootTime) / 1000) +
             " Mode=" + String(MODE_IDS[currentMode]));
    lastStatusLog = millis();
  }

  // Safe mode OLED refresh
  if (safeMode) {
    static unsigned long lastSafeOled = 0;
    if (millis() - lastSafeOled > 5000) {
      displaySafeMode();
      lastSafeOled = millis();
    }
  }

  yield();
}
