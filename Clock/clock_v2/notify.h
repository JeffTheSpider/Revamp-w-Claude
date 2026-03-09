#pragma once
// ============================================================
// Notification Overlay System
// ============================================================
// Separate from the pattern engine — overlays a short-duration
// notification (flash/pulse/strobe) then auto-reverts.
// Priority system: higher priority interrupts lower.
// Included from clock_v2.ino (single translation unit).
// ============================================================

// Notification pattern types
#define NOTIFY_FLASH  0   // Rapid on/off: 5 flashes, pause, repeat
#define NOTIFY_PULSE  1   // Smooth sine pulse in notification color
#define NOTIFY_STROBE 2   // 3 rapid strobes then pause, repeat

struct NotifyState {
  bool active;
  uint8_t r, g, b;
  uint8_t pattern;       // NOTIFY_FLASH / PULSE / STROBE
  uint16_t durationMs;   // Total notification duration
  uint8_t priority;      // 1=low, 2=medium, 3=high
  unsigned long startTime;
  unsigned long lastFrame;
  uint16_t step;         // Animation frame counter
};

static NotifyState notify = { false, 0, 0, 0, 0, 0, 0, 0, 0, 0 };

bool notifyIsActive() { return notify.active; }

// Start a notification. Higher priority interrupts lower.
void notifyStart(uint8_t r, uint8_t g, uint8_t b,
                 uint8_t pattern, uint16_t durationMs, uint8_t priority) {
  if (notify.active && priority < notify.priority) return; // Lower priority blocked
  notify.active = true;
  notify.r = r;
  notify.g = g;
  notify.b = b;
  notify.pattern = pattern;
  notify.durationMs = durationMs;
  notify.priority = priority;
  notify.startTime = millis();
  notify.lastFrame = 0;
  notify.step = 0;
  char buf[64];
  snprintf(buf, sizeof(buf), "Notify: pat=%d dur=%d pri=%d rgb=%d,%d,%d",
           pattern, durationMs, priority, r, g, b);
  logInfo(buf);
}

void notifyStop() {
  if (notify.active) {
    notify.active = false;
    logInfo("Notify ended");
  }
}

// ============================================================
// Notification Render: Flash
// ============================================================
// 5 rapid on/off flashes (100ms each), 500ms pause, repeat.
static void _notifyFlash(int br) {
  uint16_t pos = notify.step % 15; // 0-9 flash, 10-14 pause
  RgbColor c(0);
  if (pos < 10 && (pos % 2 == 0)) {
    // On frames: 0, 2, 4, 6, 8
    c = RgbColor((uint16_t)notify.r * br / 255,
                 (uint16_t)notify.g * br / 255,
                 (uint16_t)notify.b * br / 255);
  }
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
}

// ============================================================
// Notification Render: Pulse
// ============================================================
// Smooth sine breathing in notification color, ~1s period.
static void _notifyPulse(int br) {
  float phase = (float)notify.step * 6.28318f / 30.0f; // 30 frames = ~1s at 33ms
  float intensity = sinf(phase) * 0.5f + 0.5f;         // 0.0 - 1.0
  uint8_t val = (uint8_t)(br * intensity);
  RgbColor c((uint16_t)notify.r * val / 255,
             (uint16_t)notify.g * val / 255,
             (uint16_t)notify.b * val / 255);
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
}

// ============================================================
// Notification Render: Strobe
// ============================================================
// 3 rapid strobes (50ms on, 50ms off), then 400ms pause, repeat.
static void _notifyStrobe(int br) {
  uint16_t pos = notify.step % 14; // 0-5 strobe, 6-13 pause
  RgbColor c(0);
  if (pos < 6 && (pos % 2 == 0)) {
    // On frames: 0, 2, 4
    c = RgbColor((uint16_t)notify.r * br / 255,
                 (uint16_t)notify.g * br / 255,
                 (uint16_t)notify.b * br / 255);
  }
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
}

// ============================================================
// Notification Tick — call from loop() BEFORE tickPatterns()
// ============================================================
// Returns true if notification is active (caller should skip normal patterns).
bool notifyTick(int br) {
  if (!notify.active) return false;

  // Check expiry
  if (millis() - notify.startTime >= notify.durationMs) {
    notifyStop();
    return false;
  }

  // Frame rate gate: ~30fps (33ms)
  unsigned long now = millis();
  if (now - notify.lastFrame < 33) return true; // Still active but skip frame
  notify.lastFrame = now;

  // Render current notification pattern
  switch (notify.pattern) {
    case NOTIFY_FLASH:  _notifyFlash(br);  break;
    case NOTIFY_PULSE:  _notifyPulse(br);  break;
    case NOTIFY_STROBE: _notifyStrobe(br); break;
    default:            _notifyFlash(br);  break;
  }

  strip.Show();
  notify.step++;
  return true;
}
