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
// DMA/I2S broken on this chip — using BitBang method.
// 4 strips on separate GPIOs (see config.h: PIN_STRIP1-4).
// Global strip is a PIXEL BUFFER only (SetPixelColor/GetPixelColor).
// showStrip() sends each strip's pixels via fresh local NeoPixelBus objects.
NeoPixelBus<NeoGrbFeature, NeoEsp8266BitBang800KbpsMethod> strip(PIXEL_COUNT, PIN_NEOPIXEL);

// Pin list for the 4 strips, indexed 0-3
static const uint8_t STRIP_PINS[] = { PIN_STRIP1, PIN_STRIP2, PIN_STRIP3, PIN_STRIP4 };

// Send pixel buffer to all 4 strips. Each strip gets a fresh local NeoPixelBus
// (only approach that works on this chip). Pin held LOW after each send to
// prevent BitBang destructor's INPUT pull-up from driving the data line HIGH.
void __attribute__((noinline)) showStrip() {
  for (int s = 0; s < STRIPS; s++) {
    uint8_t pin = STRIP_PINS[s];
    int offset = s * LEDS_PER_STRIP;
    {
      NeoPixelBus<NeoGrbFeature, NeoEsp8266BitBang800KbpsMethod> sender(LEDS_PER_STRIP, pin);
      sender.Begin();
      for (int i = 0; i < LEDS_PER_STRIP; i++) {
        sender.SetPixelColor(i, strip.GetPixelColor(offset + i));
      }
      // Wait for bus ready + yield to prevent WDT and LED dropout
      while (!sender.CanShow()) { yield(); }
      sender.Show();
      delayMicroseconds(300);
    }
    pinMode(pin, OUTPUT); digitalWrite(pin, LOW);
  }
}

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
  MODE_WEDGE,      // Wedge: fill then drain
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
  "wedge", "pulse", "strips", "color", "off"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Red", "Green", "Blue", "White",
  "Rainbow", "Candle", "Color Wave", "Sparkle",
  "Wedge", "Pulse", "Strip Colors", "Custom", "Off"
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

// Clear all pixels and push to strip
void clearAll() {
  strip.ClearTo(RgbColor(0));
  showStrip();
}

// ============================================================
// Pattern: Solid Color
// ============================================================
void patSolid(RgbColor c) {
  if (!modeChanged) return;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
  showStrip();
}

// ============================================================
// Pattern: Rainbow Cycle
// ============================================================
// Smooth rainbow distributed across all LEDs, rotating over time.
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
    strip.SetPixelColor(i, c);
  }
  showStrip();
  patStep++;
}

// ============================================================
// Pattern: Candle Flicker
// ============================================================
// Warm flickering orange-red, simulating firelight.
// Perfect for a resin lamp - cozy ambient lighting.
void patCandle(int br) {
  unsigned long now = millis();
  if (now - lastPat < 50) return;  // 20fps for organic feel
  lastPat = now;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    uint8_t fl = (uint8_t)(random(40, 100) * (long)br / 100);
    strip.SetPixelColor(i, RgbColor(fl, fl * 40 / 100, 0));
  }
  showStrip();
}

// ============================================================
// Pattern: Color Wave
// ============================================================
// Sinusoidal blue-cyan wave traveling through the strips.
void patWave(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    float phase = (float)(i + patStep) * 6.28318f / 12.0f;
    uint8_t val = (uint8_t)((sinf(phase) * 0.5f + 0.5f) * br);
    strip.SetPixelColor(i, RgbColor(0, val / 3, val));
  }
  showStrip();
  patStep++;
}

// ============================================================
// Pattern: Sparkle
// ============================================================
// White sparkles appear randomly and fade out.
void patSparkle(int br) {
  unsigned long now = millis();
  if (now - lastPat < 50) return;
  lastPat = now;
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
  showStrip();
}

// ============================================================
// Pattern: Wedge (fill then drain)
// ============================================================
// Phase 1: Fills all pixels one-by-one in random order with
//          random colors until every LED is lit.
// Phase 2: Turns them off one-by-one in a new random order.
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
void patWedge(int br) {
  unsigned long now = millis();

  // Pause phases
  if (wedgePhase == 2) {
    if (now - wedgePauseStart >= 1000) {
      wedgePhase = 1;
      wedgePos = 0;
      wedgeShuffle();
    }
    return;
  }
  if (wedgePhase == 3) {
    if (now - wedgePauseStart >= 1000) {
      wedgePhase = 0;
      wedgePos = 0;
      wedgeShuffle();
      memset(wedgeBri, 0, sizeof(wedgeBri));
    }
    return;
  }

  // Fade tick at ~30fps
  if (now - lastPat < 33) return;
  lastPat = now;

  // Place/remove a new pixel every ~250ms
  static unsigned long lastPlacement = 0;
  if (wedgePos < PIXEL_COUNT && now - lastPlacement >= 250) {
    lastPlacement = now;
    uint8_t idx = wedgeOrder[wedgePos];
    if (wedgePhase == 0) {
      wedgeR[idx] = random(br + 1);
      wedgeG[idx] = random(br + 1);
      wedgeB[idx] = random(br + 1);
      wedgeBri[idx] = 1;
    } else {
      wedgeBri[idx] = 254;
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
      if (wedgeBri[i] > 0 && wedgeBri[i] < 255) {
        wedgeBri[i] = (wedgeBri[i] > 225) ? 255 : wedgeBri[i] + 30;
      }
      if (wedgePos >= PIXEL_COUNT && wedgeBri[i] < 255) allDone = false;
    } else {
      if (wedgeBri[i] > 0) {
        wedgeBri[i] = (wedgeBri[i] < 30) ? 0 : wedgeBri[i] - 30;
        if (wedgeBri[i] > 0) allDone = false;
      }
    }

    uint8_t scale = wedgeBri[i];
    RgbColor c(0);
    if (scale > 0) {
      RgbColor orig = strip.GetPixelColor(i);
      if (wedgePhase == 0 && wedgeBri[i] < 255) {
        c = RgbColor((uint8_t)((uint16_t)wedgeR[i] * scale / 255),
                      (uint8_t)((uint16_t)wedgeG[i] * scale / 255),
                      (uint8_t)((uint16_t)wedgeB[i] * scale / 255));
      } else if (wedgePhase == 0) {
        c = RgbColor(wedgeR[i], wedgeG[i], wedgeB[i]);
      } else {
        c = RgbColor((uint8_t)((uint16_t)orig.R * scale / 255),
                      (uint8_t)((uint16_t)orig.G * scale / 255),
                      (uint8_t)((uint16_t)orig.B * scale / 255));
      }
    }
    strip.SetPixelColor(i, c);
  }
  showStrip();

  if (wedgePos >= PIXEL_COUNT && allDone) {
    if (wedgePhase == 0) {
      wedgePhase = 2;
      wedgePauseStart = now;
    } else {
      wedgePhase = 3;
      wedgePauseStart = now;
    }
  }
}

// ============================================================
// Pattern: Pulse / Breathe
// ============================================================
// Gentle brightness pulsing - all LEDs breathe together.
// Uses sine wave for smooth organic ramp up/down.
void patPulse(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;
  // Sine wave from 0.1 to 1.0 (never fully dark)
  float phase = (float)patStep * 6.28318f / 120.0f;  // ~4s cycle at 30fps
  float intensity = sinf(phase) * 0.45f + 0.55f;
  uint8_t val = (uint8_t)(br * intensity);
  // Warm white pulse
  RgbColor c(val, val * 85 / 100, val * 65 / 100);
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
  showStrip();
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
  const int numColors = sizeof(colors) / sizeof(colors[0]);
  for (int i = 0; i < PIXEL_COUNT; i++) {
    // Clamp index to avoid array overflow if config doesn't match
    int stripIdx = i / LEDS_PER_STRIP;
    if (stripIdx >= numColors) stripIdx = numColors - 1;
    strip.SetPixelColor(i, colors[stripIdx]);
  }
  showStrip();
}

// ============================================================
// Pattern Tick (call from loop)
// ============================================================
// Routes to the active pattern. Resets state on mode changes.
void tickPatterns(int br) {
  if (modeChanged) {
    patStep = 0;
    lastPat = 0;
    wedgePos = 0; wedgePhase = 0; wedgeShuffle();
    memset(wedgeBri, 0, sizeof(wedgeBri));
    wedgePauseStart = 0;
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
    case MODE_WEDGE:    patWedge(br); break;
    case MODE_PULSE:    patPulse(br); break;
    case MODE_STRIPS:   patStrips(br); break;
    case MODE_COLOR:    patSolid(RgbColor(customR, customG, customB)); break;
    case MODE_OFF:      break;
    case MODE_COUNT:    break;  // Sentinel
  }

  modeChanged = false;
}
