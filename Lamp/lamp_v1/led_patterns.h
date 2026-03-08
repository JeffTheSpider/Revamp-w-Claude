#pragma once
// ============================================================
// Lamp LED Pattern Engine
// ============================================================
// Mode system and all LED patterns for 4-strip lamp.
// Patterns are non-blocking (state-machine ticks, no delays).
// No dead pixel handling needed (all 24 LEDs functional).
// Included from lamp_v1.ino (single translation unit).
// ============================================================

#include <NeoPixelBus.h>

// Logging (defined in lamp_v1.ino)
extern void logInfo(const String& msg);

// === NeoPixel Strip ===
// DMA method hardwired to GPIO3 (RX). Glitch-free, hardware-driven.
NeoPixelBus<NeoGrbFeature, NeoEsp8266Dma800KbpsMethod> strip(PIXEL_COUNT);

// ============================================================
// Mode System
// ============================================================
enum LedMode : uint8_t {
  MODE_RED = 0,
  MODE_GREEN,
  MODE_BLUE,
  MODE_WHITE,
  MODE_RAINBOW,    // Rainbow cycle
  MODE_CANDLE,     // Fire/candle flicker
  MODE_WAVE,       // Blue-cyan wave
  MODE_SPARKLE,    // White sparkle with fade
  MODE_PULSE,      // Gentle breathing pulse
  MODE_STRIPS,     // Each strip a different color
  MODE_COLOR,      // Custom RGB color (set via API)
  MODE_OFF,
  MODE_COUNT
};

// Machine-readable names (for API)
const char* const MODE_IDS[] = {
  "red", "green", "blue", "white",
  "rainbow", "candle", "wave", "sparkle",
  "pulse", "strips", "color", "off"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Red", "Green", "Blue", "White",
  "Rainbow", "Candle", "Color Wave", "Sparkle",
  "Pulse", "Strip Colors", "Custom", "Off"
};

LedMode currentMode = MODE_CANDLE;  // Default: cozy candle for a lamp
bool modeChanged = true;

// Look up mode enum from string ID
LedMode modeFromId(const String& id) {
  for (int i = 0; i < MODE_COUNT; i++) {
    if (id == MODE_IDS[i]) return (LedMode)i;
  }
  return MODE_CANDLE;
}

// Set the current mode (triggers pattern reset)
void setMode(LedMode mode) {
  if (mode >= MODE_COUNT) mode = MODE_CANDLE;
  if (mode == currentMode && !modeChanged) return;
  currentMode = mode;
  modeChanged = true;
  logInfo("Mode -> " + String(MODE_LABELS[mode]));
}

// ============================================================
// Pattern State
// ============================================================
unsigned long lastPat = 0;       // Throttle timer
uint16_t patStep = 0;            // Animation frame counter
uint8_t customR = 255, customG = 100, customB = 50;  // Custom color

// Set custom color and switch to color mode
void setCustomColor(uint8_t r, uint8_t g, uint8_t b) {
  customR = r; customG = g; customB = b;
  modeChanged = true;  // Force redraw
}

// Clear all pixels and push to strip
void clearAll() {
  strip.ClearTo(RgbColor(0));
  strip.Show();
}

// ============================================================
// Pattern: Solid Color
// ============================================================
void patSolid(RgbColor c) {
  if (!modeChanged) return;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
  strip.Show();
}

// ============================================================
// Pattern: Rainbow Cycle
// ============================================================
// Smooth rainbow distributed across all LEDs, rotating over time.
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
    strip.SetPixelColor(i, c);
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Pattern: Candle Flicker
// ============================================================
// Warm flickering orange-red, simulating firelight.
// Perfect for a resin lamp - cozy ambient lighting.
void patCandle(int br) {
  if (millis() - lastPat < 50) return;  // 20fps for organic feel
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    uint8_t fl = (uint8_t)(random(40, 100) * (long)br / 100);
    strip.SetPixelColor(i, RgbColor(fl, fl * 40 / 100, 0));
  }
  strip.Show();
}

// ============================================================
// Pattern: Color Wave
// ============================================================
// Sinusoidal blue-cyan wave traveling through the strips.
void patWave(int br) {
  if (millis() - lastPat < 33) return;  // 30fps
  lastPat = millis();
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float phase = (float)(i + patStep) * 6.28318f / 12.0f;
    uint8_t val = (uint8_t)((sin(phase) * 0.5f + 0.5f) * br);
    strip.SetPixelColor(i, RgbColor(0, val / 3, val));
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Pattern: Sparkle
// ============================================================
// White sparkles appear randomly and fade out.
void patSparkle(int br) {
  if (millis() - lastPat < 50) return;
  lastPat = millis();
  // Fade all pixels
  for (int i = 0; i < PIXEL_COUNT; i++) {
    RgbColor c = strip.GetPixelColor(i);
    c.R = c.R > 12 ? c.R - 12 : 0;
    c.G = c.G > 12 ? c.G - 12 : 0;
    c.B = c.B > 12 ? c.B - 12 : 0;
    strip.SetPixelColor(i, c);
  }
  // Add random bright pixel
  strip.SetPixelColor(random(PIXEL_COUNT), RgbColor(br, br, br));
  strip.Show();
}

// ============================================================
// Pattern: Pulse / Breathe
// ============================================================
// Gentle brightness pulsing - all LEDs breathe together.
// Uses sine wave for smooth organic ramp up/down.
void patPulse(int br) {
  if (millis() - lastPat < 33) return;  // 30fps
  lastPat = millis();
  // Sine wave from 0.1 to 1.0 (never fully dark)
  float phase = (float)patStep * 6.28318f / 120.0f;  // ~4s cycle at 30fps
  float intensity = sin(phase) * 0.45f + 0.55f;
  uint8_t val = (uint8_t)(br * intensity);
  // Warm white pulse
  RgbColor c(val, val * 85 / 100, val * 65 / 100);
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Pattern: Strip Colors
// ============================================================
// Each of the 4 physical strips shows a different color.
// Red, Green, Blue, Yellow for easy identification.
void patStrips(int br) {
  if (!modeChanged) return;
  const RgbColor colors[] = {
    RgbColor(br, 0, 0),      // Strip 1: Red
    RgbColor(0, br, 0),      // Strip 2: Green
    RgbColor(0, 0, br),      // Strip 3: Blue
    RgbColor(br, br, 0)      // Strip 4: Yellow
  };
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, colors[i / LEDS_PER_STRIP]);
  }
  strip.Show();
}

// ============================================================
// Pattern Tick (call from loop)
// ============================================================
// Routes to the active pattern. Resets state on mode changes.
void tickPatterns(int br) {
  if (modeChanged) {
    patStep = 0;
    lastPat = 0;
    if (currentMode == MODE_OFF) clearAll();
  }

  int wbr = br < 160 ? br : 160;  // White brightness cap

  switch (currentMode) {
    case MODE_RED:      patSolid(RgbColor(br, 0, 0)); break;
    case MODE_GREEN:    patSolid(RgbColor(0, br, 0)); break;
    case MODE_BLUE:     patSolid(RgbColor(0, 0, br)); break;
    case MODE_WHITE:    patSolid(RgbColor(wbr)); break;
    case MODE_RAINBOW:  patRainbow(br); break;
    case MODE_CANDLE:   patCandle(br); break;
    case MODE_WAVE:     patWave(br); break;
    case MODE_SPARKLE:  patSparkle(br); break;
    case MODE_PULSE:    patPulse(br); break;
    case MODE_STRIPS:   patStrips(br); break;
    case MODE_COLOR:    patSolid(RgbColor(customR, customG, customB)); break;
    case MODE_OFF:      break;
    case MODE_COUNT:    break;  // Sentinel
  }

  modeChanged = false;
}
