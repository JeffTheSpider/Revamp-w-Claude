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
  MODE_BEAT_GLOW,  // Music: pulse on bass beat
  MODE_STRIP_SPEC, // Music: 4 strips = 4 frequency bands
  MODE_COLOR_PULSE,// Music: hue cycling with beat jumps
  MODE_DAYLIGHT,   // Ambient: circadian color temp
  MODE_SUNRISE,    // Ambient: 30-min dawn alarm ramp
  MODE_FIREPLACE,  // Ambient: multi-flame orange-red
  MODE_OCEAN,      // Ambient: deep blue/turquoise waves
  MODE_FOREST,     // Ambient: green with golden sunbeams
  MODE_OFF,
  MODE_CUSTOM,     // Custom animation (uploaded from Hub)
  MODE_TIMER,      // Timer/countdown (set via API)
  MODE_COUNT
};

// Machine-readable names (for API)
const char* const MODE_IDS[] = {
  "red", "green", "blue", "white",
  "rainbow", "candle", "wave", "sparkle",
  "wedge", "pulse", "strips", "color",
  "beat_glow", "strip_spectrum", "color_pulse",
  "daylight", "sunrise", "fireplace", "ocean", "forest", "off", "custom", "timer"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Red", "Green", "Blue", "White",
  "Rainbow", "Candle", "Color Wave", "Sparkle",
  "Wedge", "Pulse", "Strip Colors", "Custom",
  "Beat Glow", "Strip Spectrum", "Color Pulse",
  "Daylight", "Sunrise", "Fireplace", "Ocean", "Forest", "Off", "Custom Anim", "Timer"
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

// Forward declaration — animations.h included after this header
bool animTick(int br);

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
unsigned long timerDurationMs = 0;   // Timer countdown total (ms)
unsigned long timerStartMs = 0;      // Timer start timestamp

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
// Music Pattern State
// ============================================================
// Music globals (musicBass, musicMid, etc.) are in lamp_v1.ino
extern bool musicActive;
extern uint8_t musicBass, musicMid, musicTreble;
extern bool musicBeat;
extern uint8_t musicBeatIntensity, musicDominant;

uint8_t beatDecay = 0;      // Fade-out after beat flash
uint16_t hueAngle = 0;      // Color Pulse hue position (0-1535)

// ============================================================
// Music Pattern: Beat Glow
// ============================================================
// All 24 LEDs pulse on beats, color based on dominant band.
// Smooth decay between beats. Fallback: existing pulse pattern.
void patBeatGlow(int br) {
  unsigned long now = millis();
  if (now - lastPat < 25) return;  // 40fps
  lastPat = now;

  if (musicActive) {
    if (musicBeat) beatDecay = 255;
    uint8_t val = (uint8_t)((uint16_t)beatDecay * br / 255);
    RgbColor c;
    switch (musicDominant) {
      case 0:  c = RgbColor(val, val / 4, 0);         break; // Bass: warm orange
      case 1:  c = RgbColor(0, val, val / 3);          break; // Mid: teal
      default: c = RgbColor(val / 2, 0, val);          break; // Treble: purple
    }
    for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, c);
    showStrip();
    beatDecay = beatDecay > 8 ? beatDecay - 8 - (beatDecay >> 4) : 0;
  } else {
    patPulse(br);  // Fallback
  }
}

// ============================================================
// Music Pattern: Strip Spectrum
// ============================================================
// 4 strips = 4 frequency bands. LEDs per strip fill proportionally.
// Strip 1: bass (red), Strip 2: low-mid (yellow), Strip 3: high-mid (green), Strip 4: treble (blue)
void patStripSpectrum(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;

  if (musicActive) {
    // Derive 4 bands from 3 inputs (low-mid = avg of bass+mid, high-mid = avg of mid+treble)
    uint8_t bands[4] = {
      musicBass,
      (uint8_t)(((uint16_t)musicBass + musicMid) / 2),
      (uint8_t)(((uint16_t)musicMid + musicTreble) / 2),
      musicTreble
    };
    const RgbColor bandColors[4] = {
      RgbColor(br, 0, 0),         // Bass: red
      RgbColor(br, br * 3/4, 0),  // Low-mid: yellow-orange
      RgbColor(0, br, 0),         // High-mid: green
      RgbColor(0, br / 4, br)     // Treble: blue
    };

    for (int s = 0; s < STRIPS; s++) {
      uint8_t fillCount = (uint16_t)bands[s] * LEDS_PER_STRIP / 255;
      for (int i = 0; i < LEDS_PER_STRIP; i++) {
        int pix = s * LEDS_PER_STRIP + i;
        if (i < fillCount) {
          // Scale color by energy
          uint8_t scale = bands[s];
          RgbColor base = bandColors[s];
          RgbColor c((uint8_t)((uint16_t)base.R * scale / 255),
                     (uint8_t)((uint16_t)base.G * scale / 255),
                     (uint8_t)((uint16_t)base.B * scale / 255));
          strip.SetPixelColor(pix, c);
        } else {
          strip.SetPixelColor(pix, RgbColor(0));
        }
      }
    }
    showStrip();
  } else {
    patStrips(br);  // Fallback: static strip colors
  }
}

// ============================================================
// Music Pattern: Color Pulse
// ============================================================
// Smooth hue cycling with big hue jump on beats. Lava-lamp feel.
// All LEDs same color, intensity modulated by overall energy.
void patColorPulse(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;

  if (musicActive) {
    // Hue advances slowly, big jump on beat
    hueAngle = (hueAngle + 2) % 1536;
    if (musicBeat) hueAngle = (hueAngle + 256) % 1536;

    // Overall energy for brightness modulation
    uint8_t energy = (uint8_t)(((uint16_t)musicBass + musicMid + musicTreble) / 3);
    uint8_t val = (uint8_t)((uint16_t)br * energy / 255);
    val = val < br / 5 ? br / 5 : val;  // Minimum 20% brightness

    // HSV to RGB (hue 0-1535, sat=255, val=val)
    uint8_t sector = hueAngle / 256;
    uint8_t frac = hueAngle % 256;
    uint8_t q = (uint8_t)((uint16_t)val * (255 - frac) / 255);
    uint8_t t = (uint8_t)((uint16_t)val * frac / 255);
    RgbColor c;
    switch (sector) {
      case 0: c = RgbColor(val, t, 0);   break;
      case 1: c = RgbColor(q, val, 0);   break;
      case 2: c = RgbColor(0, val, t);   break;
      case 3: c = RgbColor(0, q, val);   break;
      case 4: c = RgbColor(t, 0, val);   break;
      default: c = RgbColor(val, 0, q);  break;
    }
    for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, c);
    showStrip();
  } else {
    // Fallback: slow color cycling (no music)
    hueAngle = (hueAngle + 1) % 1536;
    uint8_t sector = hueAngle / 256;
    uint8_t frac = hueAngle % 256;
    uint8_t v = br / 2;  // Half brightness for ambient
    uint8_t q = (uint8_t)((uint16_t)v * (255 - frac) / 255);
    uint8_t t = (uint8_t)((uint16_t)v * frac / 255);
    RgbColor c;
    switch (sector) {
      case 0: c = RgbColor(v, t, 0);   break;
      case 1: c = RgbColor(q, v, 0);   break;
      case 2: c = RgbColor(0, v, t);   break;
      case 3: c = RgbColor(0, q, v);   break;
      case 4: c = RgbColor(t, 0, v);   break;
      default: c = RgbColor(v, 0, q);  break;
    }
    for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, c);
    showStrip();
    patStep++;
  }
}

// ============================================================
// Ambient Pattern State
// ============================================================
unsigned long sunriseStartMs = 0;   // When sunrise pattern was activated
uint16_t daylightKelvin = 4000;     // Set via /api/kelvin (Hub sends this)

// Kelvin to RGB conversion (Tanner Helland approximation)
void kelvinToRgb(int kelvin, uint8_t &r, uint8_t &g, uint8_t &b) {
  float temp = kelvin / 100.0f;
  if (temp <= 66) r = 255;
  else r = constrain((int)(329.7f * powf(temp - 60, -0.1332f)), 0, 255);
  if (temp <= 66) g = constrain((int)(99.47f * logf(temp) - 161.12f), 0, 255);
  else g = constrain((int)(288.12f * powf(temp - 60, -0.0755f)), 0, 255);
  if (temp >= 66) b = 255;
  else if (temp <= 19) b = 0;
  else b = constrain((int)(138.52f * logf(temp - 10) - 305.04f), 0, 255);
}

// ============================================================
// Ambient Pattern: Daylight
// ============================================================
// Circadian color temperature. Lamp doesn't have NTP, so it uses
// daylightKelvin set by Hub via /api/kelvin. Defaults to 4000K.
void patDaylight(int br) {
  unsigned long now = millis();
  if (now - lastPat < 1000) return;  // Update once per second
  lastPat = now;

  uint8_t r, g, b;
  kelvinToRgb(daylightKelvin, r, g, b);
  r = (uint8_t)((uint16_t)r * br / 255);
  g = (uint8_t)((uint16_t)g * br / 255);
  b = (uint8_t)((uint16_t)b * br / 255);
  for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, RgbColor(r, g, b));
  showStrip();
}

// ============================================================
// Ambient Pattern: Sunrise Alarm
// ============================================================
// 30-minute ramp from dark to warm white. Self-contained timer.
void patSunrise(int br) {
  unsigned long now = millis();
  if (now - lastPat < 100) return;  // 10fps
  lastPat = now;

  unsigned long elapsed = now - sunriseStartMs;
  float progress = (float)elapsed / 1800000.0f;  // 0.0 to 1.0 over 30 min
  if (progress > 1.0f) progress = 1.0f;

  uint8_t rampBr = (uint8_t)(progress * br);
  int kelvin = 1800 + (int)(progress * 3200);
  uint8_t r, g, b;
  kelvinToRgb(kelvin, r, g, b);
  r = (uint8_t)((uint16_t)r * rampBr / 255);
  g = (uint8_t)((uint16_t)g * rampBr / 255);
  b = (uint8_t)((uint16_t)b * rampBr / 255);

  for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, RgbColor(r, g, b));
  showStrip();
}

// ============================================================
// Ambient Pattern: Fireplace
// ============================================================
// Each strip is a flame column with independent flicker.
void patFireplace(int br) {
  unsigned long now = millis();
  if (now - lastPat < 40) return;  // 25fps
  lastPat = now;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    uint8_t flicker = random(30, 100);
    uint8_t intensity = (uint8_t)((uint16_t)flicker * br / 100);
    uint8_t r = intensity;
    uint8_t g = (uint8_t)((uint16_t)intensity * flicker / 180);
    uint8_t b = (flicker > 85) ? (uint8_t)((uint16_t)intensity * (flicker - 85) / 200) : 0;
    strip.SetPixelColor(i, RgbColor(r, g, b));
  }
  showStrip();
}

// ============================================================
// Ambient Pattern: Ocean
// ============================================================
// Deep blue with turquoise waves rippling down the strips.
void patOcean(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    float wave1 = sinf((float)(i + patStep) * 6.28318f / 8.0f) * 0.5f + 0.5f;
    float wave2 = sinf((float)(i * 3 + patStep * 2) * 6.28318f / 13.0f) * 0.3f + 0.5f;
    float combined = wave1 * 0.6f + wave2 * 0.4f;

    uint8_t b_val = (uint8_t)(br * (0.3f + combined * 0.7f));
    uint8_t g_val = (uint8_t)(br * combined * 0.5f);
    uint8_t r_val = 0;
    if (random(200) == 0) {
      r_val = br / 2; g_val = br / 2; b_val = br;
    }
    strip.SetPixelColor(i, RgbColor(r_val, g_val, b_val));
  }
  showStrip();
  patStep++;
}

// ============================================================
// Ambient Pattern: Forest
// ============================================================
// Green canopy with dappled golden sunbeams moving through strips.
void patForest(int br) {
  unsigned long now = millis();
  if (now - lastPat < 40) return;  // 25fps
  lastPat = now;

  // Sunbeam sweeps through the 24 pixels
  float beamCenter = (float)(patStep % 480) / 480.0f * PIXEL_COUNT;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    float sway = sinf((float)(i * 2 + patStep) * 6.28318f / 10.0f) * 0.15f + 0.85f;
    uint8_t g_val = (uint8_t)(br * sway * 0.7f);
    uint8_t r_val = (uint8_t)(br * sway * 0.15f);
    uint8_t b_val = (uint8_t)(br * sway * 0.05f);

    // Sunbeam: golden overlay (width ~3 pixels for shorter strip)
    float dist = (float)i - beamCenter;
    if (dist > PIXEL_COUNT / 2) dist -= PIXEL_COUNT;
    if (dist < -PIXEL_COUNT / 2) dist += PIXEL_COUNT;
    float beamIntensity = 1.0f - fabsf(dist) / 2.0f;
    if (beamIntensity > 0) {
      beamIntensity *= beamIntensity;
      uint8_t gold = (uint8_t)(br * beamIntensity * 0.6f);
      r_val = (r_val + gold > 255) ? 255 : r_val + gold;
      g_val = (g_val + gold * 3 / 4 > 255) ? 255 : g_val + gold * 3 / 4;
    }
    strip.SetPixelColor(i, RgbColor(r_val, g_val, b_val));
  }
  showStrip();
  patStep++;
}

// ============================================================
// Timer/Countdown Pattern
// ============================================================
void patTimer(int br) {
  unsigned long now = millis();
  if (now - lastPat < 50) return;
  lastPat = now;

  unsigned long elapsed = now - timerStartMs;
  if (timerDurationMs == 0 || elapsed >= timerDurationMs) {
    if (elapsed < timerDurationMs + 3000) {
      bool flash = ((elapsed / 250) % 2) == 0;
      RgbColor c = flash ? RgbColor(br, 0, 0) : RgbColor(0, 0, 0);
      for (int i = 0; i < PIXEL_COUNT; i++) strip.SetPixelColor(i, c);
    } else {
      setMode(MODE_CANDLE);
      return;
    }
    showStrip();
    return;
  }

  float progress = (float)elapsed / (float)timerDurationMs;
  float remaining = 1.0f - progress;
  int litPixels = (int)(remaining * PIXEL_COUNT + 0.5f);

  for (int i = 0; i < PIXEL_COUNT; i++) {
    if (i < litPixels) {
      uint8_t r, g;
      if (remaining > 0.5f) {
        r = (uint8_t)((1.0f - (remaining - 0.5f) * 2.0f) * br);
        g = (uint8_t)(br * 0.8f);
      } else {
        r = (uint8_t)(br * 0.8f);
        g = (uint8_t)(remaining * 2.0f * br * 0.8f);
      }
      strip.SetPixelColor(i, RgbColor(r, g, 0));
    } else {
      strip.SetPixelColor(i, RgbColor(0, 0, 0));
    }
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
    beatDecay = 0; hueAngle = 0;
    sunriseStartMs = millis();
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
    case MODE_BEAT_GLOW:  patBeatGlow(br); break;
    case MODE_STRIP_SPEC: patStripSpectrum(br); break;
    case MODE_COLOR_PULSE: patColorPulse(br); break;
    case MODE_DAYLIGHT:   patDaylight(br); break;
    case MODE_SUNRISE:    patSunrise(br); break;
    case MODE_FIREPLACE:  patFireplace(br); break;
    case MODE_OCEAN:      patOcean(br); break;
    case MODE_FOREST:     patForest(br); break;
    case MODE_OFF:      break;
    case MODE_CUSTOM:     animTick(br); break;
    case MODE_TIMER:      patTimer(br); break;
    case MODE_COUNT:    break;  // Sentinel
  }

  modeChanged = false;
}
