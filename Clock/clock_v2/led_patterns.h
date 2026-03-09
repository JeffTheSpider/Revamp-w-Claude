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
// Pixel Helpers
// ============================================================
// All 60 LEDs confirmed working (2026-03-09).
// Previously LEDs 0, 55-59 were masked as dead — they were fine.
const uint8_t NUM_DEAD = 0;

bool isDeadPixel(uint8_t p) { return false; }

void setPixel(uint8_t p, RgbColor c) {
  if (p >= PIXEL_COUNT) return;
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
  MODE_WEDGE,      // Wedge: fill then drain
  MODE_SPECIAL3,   // Brightness sweep
  MODE_RAINBOW,    // Rainbow cycle (replaces empty Special4)
  MODE_CANDLE,     // Fire/candle flicker
  MODE_WAVE,       // Blue-cyan wave
  MODE_SPARKLE,    // White sparkle with fade
  MODE_COLOR,      // Custom RGB color (set via API)
  MODE_OFF,
  MODE_COUNT
};

// Machine-readable names (for API)
const char* const MODE_IDS[] = {
  "clock", "red", "green", "blue", "white",
  "special1", "wedge", "special3",
  "rainbow", "candle", "wave", "sparkle", "color", "off"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Clock", "Red", "Green", "Blue", "White",
  "Blue Flash", "Wedge", "Sweep",
  "Rainbow", "Candle", "Color Wave", "Sparkle", "Custom", "Off"
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
uint8_t customR = 255, customG = 100, customB = 50;  // Custom color (set via API)

// Wedge pattern state
uint8_t wedgeOrder[PIXEL_COUNT];   // Shuffled pixel indices
uint8_t wedgePos = 0;              // Current position in order array
uint8_t wedgePhase = 0;            // 0=filling, 1=draining, 2=pause-lit, 3=pause-dark
uint8_t wedgeBri[PIXEL_COUNT];     // Per-pixel brightness (0-255 fade progress)
uint8_t wedgeR[PIXEL_COUNT];       // Per-pixel target R
uint8_t wedgeG[PIXEL_COUNT];       // Per-pixel target G
uint8_t wedgeB[PIXEL_COUNT];       // Per-pixel target B
unsigned long wedgePauseStart = 0; // Pause timer

// Set custom color and switch to color mode
void setCustomColor(uint8_t r, uint8_t g, uint8_t b) {
  customR = r; customG = g; customB = b;
  modeChanged = true;  // Force redraw
}

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
  unsigned long now = millis();
  if (now - lastPat < 100) return;
  lastPat = now;
  setPixel(random(PIXEL_COUNT), RgbColor(0, 0, br));
  strip.Show();
}

// ============================================================
// Pattern: Wedge (Charlie's original "Multicolor", renamed)
// ============================================================
// Phase 1: Fills all pixels one-by-one in random order with
//          random colors until every LED is lit.
// Phase 2: Turns them off one-by-one in a new random order
//          until all are dark. Then loops back to Phase 1.
// Fisher-Yates shuffle for truly random, non-repeating order.

void wedgeShuffle() {
  for (uint8_t i = 0; i < PIXEL_COUNT; i++) wedgeOrder[i] = i;
  for (uint8_t i = PIXEL_COUNT - 1; i > 0; i--) {
    uint8_t j = random(i + 1);
    uint8_t tmp = wedgeOrder[i];
    wedgeOrder[i] = wedgeOrder[j];
    wedgeOrder[j] = tmp;
  }
}

// Enhanced Wedge: LEDs fade up/down smoothly, pause when all lit/dark
// Phase 0: filling (place new pixel every 250ms, all pixels fade toward target)
// Phase 1: draining (mark pixel for fade-out every 250ms)
// Phase 2: pause when all lit (~1s)
// Phase 3: pause when all dark (~1s)
void patWedge(int br) {
  unsigned long now = millis();

  // Pause phases
  if (wedgePhase == 2) {
    if (now - wedgePauseStart >= 1000) {
      wedgePhase = 1;  // Start draining
      wedgePos = 0;
      wedgeShuffle();
    }
    return;  // Hold all LEDs at full brightness during pause
  }
  if (wedgePhase == 3) {
    if (now - wedgePauseStart >= 1000) {
      wedgePhase = 0;  // Start filling
      wedgePos = 0;
      wedgeShuffle();
      memset(wedgeBri, 0, sizeof(wedgeBri));
    }
    return;  // Hold all LEDs off during pause
  }

  // Fade tick at ~30fps for smooth transitions
  if (now - lastPat < 33) return;
  lastPat = now;

  // Place/remove a new pixel every ~250ms (every ~8 frames)
  static unsigned long lastPlacement = 0;
  if (wedgePos < PIXEL_COUNT && now - lastPlacement >= 250) {
    lastPlacement = now;
    uint8_t idx = wedgeOrder[wedgePos];
    if (wedgePhase == 0) {
      // Assign random target color for this pixel
      wedgeR[idx] = random(br + 1);
      wedgeG[idx] = random(br + 1);
      wedgeB[idx] = random(br + 1);
      wedgeBri[idx] = 1;  // Start fading up (non-zero = active)
    } else {
      wedgeBri[idx] = 254;  // Mark for fade-down (will go to 0)
      wedgeR[idx] = 0;
      wedgeG[idx] = 0;
      wedgeB[idx] = 0;
    }
    wedgePos++;
  }

  // Animate all pixels toward their targets
  bool allDone = true;
  for (uint8_t i = 0; i < PIXEL_COUNT; i++) {
    if (wedgePhase == 0) {
      // Fading up: increase brightness toward 255
      if (wedgeBri[i] > 0 && wedgeBri[i] < 255) {
        wedgeBri[i] = (wedgeBri[i] > 225) ? 255 : wedgeBri[i] + 30;
      }
      // Check if all placed pixels are fully bright
      if (wedgePos >= PIXEL_COUNT && wedgeBri[i] < 255) allDone = false;
    } else {
      // Fading down: decrease brightness toward 0
      if (wedgeBri[i] > 0) {
        wedgeBri[i] = (wedgeBri[i] < 30) ? 0 : wedgeBri[i] - 30;
        if (wedgeBri[i] > 0) allDone = false;
      }
    }

    // Apply brightness to pixel
    uint8_t scale = wedgeBri[i];
    RgbColor c(0);
    if (scale > 0) {
      // Original target colors are stored; scale by fade progress
      RgbColor orig = strip.GetPixelColor(i);
      if (wedgePhase == 0 && wedgeBri[i] < 255) {
        // Fading up: scale target color by brightness
        c = RgbColor((uint8_t)((uint16_t)wedgeR[i] * scale / 255),
                      (uint8_t)((uint16_t)wedgeG[i] * scale / 255),
                      (uint8_t)((uint16_t)wedgeB[i] * scale / 255));
      } else if (wedgePhase == 0) {
        c = RgbColor(wedgeR[i], wedgeG[i], wedgeB[i]);
      } else {
        // Fading down: get current color and scale it down
        c = RgbColor((uint8_t)((uint16_t)orig.R * scale / 255),
                      (uint8_t)((uint16_t)orig.G * scale / 255),
                      (uint8_t)((uint16_t)orig.B * scale / 255));
      }
    }
    setPixel(i, c);
  }
  strip.Show();

  // Check for phase transitions
  if (wedgePos >= PIXEL_COUNT && allDone) {
    if (wedgePhase == 0) {
      wedgePhase = 2;  // Pause with all lit
      wedgePauseStart = now;
    } else {
      wedgePhase = 3;  // Pause with all dark
      wedgePauseStart = now;
    }
  }
}

// ============================================================
// Pattern: Special 3 - Brightness Sweep
// ============================================================
// Sweeps all LEDs through blue brightness 0-255, then wraps.
void patSpecial3() {
  unsigned long now = millis();
  if (now - lastPat < 100) return;
  lastPat = now;
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
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // ~30fps
  lastPat = now;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float hue = (float)((i + patStep) % PIXEL_COUNT) / PIXEL_COUNT;
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
  unsigned long now = millis();
  if (now - lastPat < 50) return;  // 20fps for organic feel
  lastPat = now;
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
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float phase = (float)(i + patStep) * 6.28318f / 15.0f;
    uint8_t val = (uint8_t)((sinf(phase) * 0.5f + 0.5f) * br);
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
  unsigned long now = millis();
  if (now - lastPat < 50) return;
  lastPat = now;
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
    wedgePos = 0; wedgePhase = 0; wedgeShuffle();
    memset(wedgeBri, 0, sizeof(wedgeBri));
    wedgePauseStart = 0;
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
    case MODE_WEDGE:    patWedge(br); break;
    case MODE_SPECIAL3: patSpecial3(); break;
    case MODE_RAINBOW:  patRainbow(br); break;
    case MODE_CANDLE:   patCandle(br); break;
    case MODE_WAVE:     patWave(br); break;
    case MODE_SPARKLE:  patSparkle(br); break;
    case MODE_COLOR:    patSolid(RgbColor(customR, customG, customB)); break;
    case MODE_OFF:      break;
    case MODE_COUNT:    break;  // Sentinel, not a real mode
  }

  modeChanged = false;
}
