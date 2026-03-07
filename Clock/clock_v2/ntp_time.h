#pragma once
// ============================================================
// NTP Time Sync + UK Timezone
// ============================================================
// Handles NTP synchronization, BST/GMT auto-switching,
// and formatted time/date strings for display.
// Included from clock_v2.ino (single translation unit).
// ============================================================

#include <WiFiUdp.h>
#include <NTPClient.h>
#include <TimeLib.h>
#include <Timezone.h>

// Logging (defined in clock_v2.ino)
extern void logInfo(const String& msg);
extern void logWarn(const String& msg);

// === NTP Client (offset=0, timezone handled separately) ===
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, NTP_SERVER, 0, NTP_SYNC_INTERVAL_MS);

// === UK Timezone Rules ===
// BST: Last Sunday in March at 1:00 AM local -> clocks forward, UTC+1
// GMT: Last Sunday in October at 2:00 AM local -> clocks back, UTC+0
TimeChangeRule ukBST = {"BST", Last, Sun, Mar, 1, 60};
TimeChangeRule ukGMT = {"GMT", Last, Sun, Oct, 2, 0};
Timezone ukTimezone(ukBST, ukGMT);

// === Formatted Strings (updated each second) ===
// Fixed char buffers avoid heap fragmentation from String rebuilds.
char dateStr[32] = "";   // "Monday, Jan 5, 2026"
char timeStr[12] = "";   // "3:05 PM"
char secondStr[4] = "";  // "59"

// Day and month names for display
const char* const dayNames[] = {
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday"
};
const char* const monthNames[] = {
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
};

// Start the NTP client
void ntpBegin() {
  timeClient.begin();
  logInfo("NTP client started");
}

// Sync time from NTP server, apply UK timezone
bool ntpSync() {
  if (!timeClient.forceUpdate()) {
    logWarn("NTP sync failed");
    return false;
  }

  time_t utc = timeClient.getEpochTime();
  time_t local = ukTimezone.toLocal(utc);
  setTime(local);

  char buf[40];
  snprintf(buf, sizeof(buf), "NTP synced: %d:%02d %d/%d/%d",
           hour(), minute(), day(), month(), year());
  logInfo(buf);
  return true;
}

// Update the formatted time/date strings (call once per second)
void updateTimeStrings() {
  snprintf(dateStr, sizeof(dateStr), "%s, %s %d, %d",
           dayNames[weekday() - 1], monthNames[month() - 1],
           day(), year());

  snprintf(timeStr, sizeof(timeStr), "%d:%02d %s",
           hourFormat12(), minute(), isPM() ? "PM" : "AM");

  snprintf(secondStr, sizeof(secondStr), "%d", second());
}

// Check if NTP has set a valid time (not 1970)
bool isTimeValid() {
  return year() > 2020;
}
