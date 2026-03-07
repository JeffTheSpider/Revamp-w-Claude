#pragma once
// ============================================================
// LED Pattern Engine
// ============================================================
// Dead pixel map, mode system, and all LED patterns.
// Patterns are non-blocking (state-machine ticks, no delays).
// Included from clock_v2.ino (single translation unit).
// ============================================================

#include <NeoPixelBus.h>
#include <TimeLib.h>

// Logging (defined in clock_v2.ino)
extern void logInfo(const String& msg);

// === NeoPixel Strip ===
// DMA method hardwired to GPIO3 (RX). Glitch-free, hardware-driven.
NeoPixelBus<NeoGrbFeature, NeoEsp8266Dma800KbpsMethod> strip(PIXEL_COUNT);

// ============================================================
// Dead Pixel Map
// ============================================================
// LEDs 0, 55-59 are physically dead (no light output).
// LED 54 is degraded (yellow tint, reduced output).
const uint8_t NUM_DEAD = 6;
const uint8_t DEGRADED_PIXEL = 54;

// Bitmask for O(1) dead pixel lookup (bits 0, 55-59 set)
const uint64_t DEAD_MASK = (1ULL << 0) | (1ULL << 55) | (1ULL << 56) |
                           (1ULL << 57) | (1ULL << 58) | (1ULL << 59);

bool isDeadPixel(uint8_t p) {
  return p < 64 && (DEAD_MASK & (1ULL << p));
}

// Write a color to a pixel, skipping dead ones and dimming degraded
void setPixel(uint8_t p, RgbColor c) {
  if (p >= PIXEL_COUNT || isDeadPixel(p)) return;
  if (p == DEGRADED_PIXEL) {
    c = RgbColor(c.R * 3 / 4, c.G * 3 / 4, c.B * 3 / 4);
  }
  strip.SetPixelColor(p, c);
}

// Clear all pixels and push to strip
void clearAll() {
  strip.ClearTo(RgbColor(0));
  strip.Show();
}

// ============================================================
// Mode System
// ============================================================
enum LedMode : uint8_t {
  MODE_CLOCK = 0,
  MODE_RED,
  MODE_GREEN,
  MODE_BLUE,
  MODE_WHITE,
  MODE_SPECIAL1,   // Random blue flash
  MODE_SPECIAL2,   // Random multicolor
  MODE_SPECIAL3,   // Brightness sweep
  MODE_RAINBOW,    // Rainbow cycle (replaces empty Special4)
  MODE_CANDLE,     // Fire/candle flicker
  MODE_WAVE,       // Blue-cyan wave
  MODE_SPARKLE,    // White sparkle with fade
  MODE_OFF,
  MODE_COUNT
};

// Machine-readable names (for API)
const char* const MODE_IDS[] = {
  "clock", "red", "green", "blue", "white",
  "special1", "special2", "special3",
  "rainbow", "candle", "wave", "sparkle", "off"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Clock", "Red", "Green", "Blue", "White",
  "Blue Flash", "Multicolor", "Sweep",
  "Rainbow", "Candle", "Color Wave", "Sparkle", "Off"
};

LedMode currentMode = MODE_CLOCK;
bool modeChanged = true;

// Look up mode enum from string ID
LedMode modeFromId(const String& id) {
  for (int i = 0; i < MODE_COUNT; i++) {
    if (id == MODE_IDS[i]) return (LedMode)i;
  }
  return MODE_CLOCK;
}

// Set the current mode (triggers pattern reset)
void setMode(LedMode mode) {
  if (mode >= MODE_COUNT) mode = MODE_CLOCK;
  if (mode == currentMode && !modeChanged) return;
  currentMode = mode;
  modeChanged = true;
  logInfo("Mode -> " + String(MODE_LABELS[mode]));
}

// ============================================================
// Pattern State
// ============================================================
int prevH = -1, prevM = -1, prevS = -1;  // Clock face tracking
unsigned long lastPat = 0;                 // Throttle timer
uint16_t patStep = 0;                      // Animation frame counter
uint8_t sweepVal = 0;                      // Special3 brightness ramp

// ============================================================
// Pattern: Clock Face
// ============================================================
// Hour=green (5-pixel intervals), Minute=blue, Second=red.
// Uses full-redraw approach: clear changed pixels, then layer
// hour -> minute -> second in priority order. This correctly
// handles all overlap cases including simultaneous changes.
void patClock(int br) {
  int h = hourFormat12() % 12;
  int m = minute();
  int s = second();
  int hP = h * 5;

  // First frame or mode change: full redraw
  if (modeChanged) {
    clearAll();
    setPixel(hP, RgbColor(0, br, 0));
    setPixel(m, RgbColor(0, 0, br));
    setPixel(s, RgbColor(br, 0, 0));
    strip.Show();
    prevH = h; prevM = m; prevS = s;
    return;
  }

  if (s == prevS) return;  // No change this tick

  // Step 1: Clear all OLD hand positions
  if (prevS >= 0) setPixel(prevS, RgbColor(0));
  if (prevM >= 0 && prevM != m) setPixel(prevM, RgbColor(0));
  if (prevH >= 0 && prevH != h) setPixel(prevH * 5, RgbColor(0));

  // Step 2: Redraw all CURRENT hands in priority order (hour < minute < second)
  // Later draws overwrite earlier ones at overlapping positions
  setPixel(hP, RgbColor(0, br, 0));       // hour: green
  setPixel(m, RgbColor(0, 0, br));         // minute: blue (overwrites hour if same)
  setPixel(s, RgbColor(br, 0, 0));         // second: red (overwrites both if same)

  strip.Show();
  prevH = h; prevM = m; prevS = s;
}

// ============================================================
// Pattern: Solid Color
// ============================================================
// Only redraws when mode or brightness changes.
void patSolid(RgbColor c) {
  if (!modeChanged) return;
  for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, c);
  strip.Show();
}

// ============================================================
// Pattern: Special 1 - Random Blue Flash
// ============================================================
// Randomly lights blue pixels. Pixels accumulate, creating a
// growing constellation of blue dots.
void patSpecial1(int br) {
  if (millis() - lastPat < 100) return;
  lastPat = millis();
  setPixel(random(PIXEL_COUNT), RgbColor(0, 0, br));
  strip.Show();
}

// ============================================================
// Pattern: Special 2 - Random Multicolor
// ============================================================
// Randomly lights pixels in random colors. Creates a colorful
// mosaic that fills over time.
void patSpecial2(int br) {
  if (millis() - lastPat < 100) return;
  lastPat = millis();
  int r = random(br + 1), g = random(br + 1), b = random(br + 1);
  setPixel(random(PIXEL_COUNT), RgbColor(r, g, b));
  strip.Show();
}

// ============================================================
// Pattern: Special 3 - Brightness Sweep
// ============================================================
// Sweeps all LEDs through blue brightness 0-255, then wraps.
void patSpecial3() {
  if (millis() - lastPat < 100) return;
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    setPixel(i, RgbColor(0, 0, sweepVal));
  }
  strip.Show();
  sweepVal++;  // uint8_t wraps at 255
}

// ============================================================
// Pattern: Rainbow Cycle
// ============================================================
// Smooth rainbow distributed across the ring, rotating over time.
void patRainbow(int br) {
  if (millis() - lastPat < 33) return;  // ~30fps
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float hue = fmod((float)(i + patStep) / PIXEL_COUNT, 1.0f);
    float h6 = hue * 6.0f;
    int sector = (int)h6;
    float frac = h6 - sector;
    uint8_t v = br;
    uint8_t q = (uint8_t)(v * (1.0f - frac));
    uint8_t t = (uint8_t)(v * frac);
    RgbColor c;
    switch (sector % 6) {
      case 0: c = RgbColor(v, t, 0); break;
      case 1: c = RgbColor(q, v, 0); break;
      case 2: c = RgbColor(0, v, t); break;
      case 3: c = RgbColor(0, q, v); break;
      case 4: c = RgbColor(t, 0, v); break;
      default: c = RgbColor(v, 0, q); break;
    }
    setPixel(i, c);
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Pattern: Candle Flicker
// ============================================================
// Warm flickering orange-red, simulating firelight.
void patCandle(int br) {
  if (millis() - lastPat < 50) return;  // 20fps for organic feel
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    uint8_t fl = (uint8_t)(random(40, 100) * (long)br / 100);
    setPixel(i, RgbColor(fl, fl * 40 / 100, 0));
  }
  strip.Show();
}

// ============================================================
// Pattern: Color Wave
// ============================================================
// Sinusoidal blue-cyan wave traveling around the ring.
void patWave(int br) {
  if (millis() - lastPat < 33) return;  // 30fps
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float phase = (float)(i + patStep) * 6.28318f / 15.0f;
    uint8_t val = (uint8_t)((sin(phase) * 0.5f + 0.5f) * br);
    setPixel(i, RgbColor(0, val / 3, val));
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Pattern: Sparkle
// ============================================================
// White sparkles appear randomly and fade out, creating a
// twinkling star field effect.
void patSparkle(int br) {
  if (millis() - lastPat < 50) return;
  lastPat = millis();
  // Fade all live pixels
  for (int i = 0; i < PIXEL_COUNT; i++) {
    if (isDeadPixel(i)) continue;
    RgbColor c = strip.GetPixelColor(i);
    c.R = c.R > 12 ? c.R - 12 : 0;
    c.G = c.G > 12 ? c.G - 12 : 0;
    c.B = c.B > 12 ? c.B - 12 : 0;
    strip.SetPixelColor(i, c);
  }
  // Add random bright pixel
  int p = random(PIXEL_COUNT);
  if (!isDeadPixel(p)) {
    setPixel(p, RgbColor(br, br, br));
  }
  strip.Show();
}

// ============================================================
// Pattern Tick (call from loop)
// ============================================================
// Routes to the active pattern. Resets state on mode changes.
void tickPatterns(int br) {
  if (modeChanged) {
    prevH = -1; prevM = -1; prevS = -1;
    patStep = 0; sweepVal = 0; lastPat = 0;
    if (currentMode == MODE_OFF) clearAll();
  }

  int wbr = br < 160 ? br : 160;  // White brightness cap

  switch (currentMode) {
    case MODE_CLOCK:    patClock(br); break;
    case MODE_RED:      patSolid(RgbColor(br, 0, 0)); break;
    case MODE_GREEN:    patSolid(RgbColor(0, br, 0)); break;
    case MODE_BLUE:     patSolid(RgbColor(0, 0, br)); break;
    case MODE_WHITE:    patSolid(RgbColor(wbr)); break;
    case MODE_SPECIAL1: patSpecial1(br); break;
    case MODE_SPECIAL2: patSpecial2(br); break;
    case MODE_SPECIAL3: patSpecial3(); break;
    case MODE_RAINBOW:  patRainbow(br); break;
    case MODE_CANDLE:   patCandle(br); break;
    case MODE_WAVE:     patWave(br); break;
    case MODE_SPARKLE:  patSparkle(br); break;
    case MODE_OFF:      break;
    case MODE_COUNT:    break;  // Sentinel, not a real mode
  }

  modeChanged = false;
}
