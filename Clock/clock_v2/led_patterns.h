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
  MODE_BEAT_PULSE, // Music: flash on bass beat
  MODE_SPECTRUM,   // Music: 3-band ring spectrum
  MODE_BEAT_CHASE, // Music: spinning comet + beat boost
  MODE_DAYLIGHT,   // Ambient: circadian color temp (NTP-driven)
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
  "clock", "red", "green", "blue", "white",
  "special1", "wedge", "special3",
  "rainbow", "candle", "wave", "sparkle", "color",
  "beat_pulse", "spectrum", "beat_chase",
  "daylight", "sunrise", "fireplace", "ocean", "forest", "off", "custom", "timer"
};

// Human-readable labels (for UI)
const char* const MODE_LABELS[] = {
  "Clock", "Red", "Green", "Blue", "White",
  "Blue Flash", "Wedge", "Sweep",
  "Rainbow", "Candle", "Color Wave", "Sparkle", "Custom",
  "Beat Pulse", "Spectrum", "Beat Chase",
  "Daylight", "Sunrise", "Fireplace", "Ocean", "Forest", "Off", "Custom Anim", "Timer"
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

// Forward declaration — animations.h included after this header
bool animTick(int br);

// ============================================================
// Pattern State
// ============================================================
int prevH = -1, prevM = -1, prevS = -1;  // Clock face tracking
unsigned long lastPat = 0;                 // Throttle timer
uint16_t patStep = 0;                      // Animation frame counter
uint8_t sweepVal = 0;                      // Special3 brightness ramp
uint8_t customR = 255, customG = 100, customB = 50;  // Custom color (set via API)
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
void patSpecial3(int br) {
  unsigned long now = millis();
  if (now - lastPat < 100) return;
  lastPat = now;
  uint8_t v = (uint16_t)sweepVal * br / 255;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    setPixel(i, RgbColor(0, 0, v));
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
// Music Pattern State
// ============================================================
// Music globals (musicBass, musicMid, etc.) are in clock_v2.ino
extern bool musicActive;
extern uint8_t musicBass, musicMid, musicTreble;
extern bool musicBeat;
extern uint8_t musicBeatIntensity, musicDominant;

uint8_t beatDecay = 0;          // Fade-out after beat flash
uint16_t chasePos = 0;          // Beat Chase comet position (fixed-point, /256)
uint16_t chaseSpeed = 512;      // Beat Chase speed (fixed-point, /256)

// ============================================================
// Music Pattern: Beat Pulse
// ============================================================
// All 60 LEDs flash on bass beats, color shifts by dominant band.
// Smooth exponential decay between beats. Fallback: gentle sine.
void patBeatPulse(int br) {
  unsigned long now = millis();
  if (now - lastPat < 25) return;  // 40fps
  lastPat = now;

  if (musicActive) {
    // On beat: flash bright
    if (musicBeat) {
      beatDecay = 255;
    }
    // Color based on dominant band
    RgbColor c;
    uint8_t val = (uint8_t)((uint16_t)beatDecay * br / 255);
    switch (musicDominant) {
      case 0:  c = RgbColor(val, val / 4, 0);         break; // Bass: warm orange
      case 1:  c = RgbColor(0, val, val / 3);          break; // Mid: teal
      default: c = RgbColor(val / 2, 0, val);          break; // Treble: purple
    }
    for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, c);
    strip.Show();
    // Exponential decay
    beatDecay = beatDecay > 8 ? beatDecay - 8 - (beatDecay >> 4) : 0;
  } else {
    // Fallback: gentle sine pulse (warm white)
    float phase = (float)patStep * 6.28318f / 90.0f;
    uint8_t val = (uint8_t)((sinf(phase) * 0.4f + 0.6f) * br);
    RgbColor c(val, val * 85 / 100, val * 65 / 100);
    for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, c);
    strip.Show();
    patStep++;
  }
}

// ============================================================
// Music Pattern: Spectrum Ring
// ============================================================
// 60 LEDs / 3 = 20 per band. Bass=red, Mid=green, Treble=blue.
// LEDs fill proportionally to band energy. Fallback: rainbow.
void patSpectrum(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;

  if (musicActive) {
    // How many LEDs to light in each 20-LED band
    uint8_t bassLeds = (uint16_t)musicBass * 20 / 255;
    uint8_t midLeds  = (uint16_t)musicMid  * 20 / 255;
    uint8_t trebLeds = (uint16_t)musicTreble * 20 / 255;

    for (int i = 0; i < PIXEL_COUNT; i++) {
      RgbColor c(0);
      if (i < 20) {
        // Bass section (LEDs 0-19): red
        if (i < bassLeds) {
          uint8_t v = (uint8_t)((uint16_t)br * musicBass / 255);
          c = RgbColor(v, v / 6, 0);
        }
      } else if (i < 40) {
        // Mid section (LEDs 20-39): green
        int j = i - 20;
        if (j < midLeds) {
          uint8_t v = (uint8_t)((uint16_t)br * musicMid / 255);
          c = RgbColor(0, v, v / 6);
        }
      } else {
        // Treble section (LEDs 40-59): blue
        int j = i - 40;
        if (j < trebLeds) {
          uint8_t v = (uint8_t)((uint16_t)br * musicTreble / 255);
          c = RgbColor(v / 6, 0, v);
        }
      }
      setPixel(i, c);
    }
    strip.Show();
  } else {
    // Fallback: slow rainbow
    patRainbow(br);
  }
}

// ============================================================
// Music Pattern: Beat Chase
// ============================================================
// Spinning rainbow comet. Speed scales with bass energy,
// big speed boost on beat. Trail length scales with intensity.
void patBeatChase(int br) {
  unsigned long now = millis();
  if (now - lastPat < 25) return;  // 40fps
  lastPat = now;

  if (musicActive) {
    // Speed: base + bass-proportional + beat burst
    uint16_t targetSpeed = 256 + (uint16_t)musicBass * 4;
    if (musicBeat) targetSpeed += 2048;
    // Smooth toward target
    if (chaseSpeed < targetSpeed) chaseSpeed += (targetSpeed - chaseSpeed) / 4 + 1;
    else chaseSpeed -= (chaseSpeed - targetSpeed) / 8 + 1;

    // Advance position (fixed-point /256, wraps at PIXEL_COUNT*256)
    chasePos = (chasePos + chaseSpeed / 16) % (PIXEL_COUNT * 256);
    uint8_t headPix = chasePos / 256;

    // Trail length: 3-12 based on intensity
    uint8_t trail = 3 + (uint16_t)musicBeatIntensity * 9 / 255;

    // Draw comet with rainbow hue at head
    for (int i = 0; i < PIXEL_COUNT; i++) {
      // Distance from head (wrapping)
      int dist = (headPix - i + PIXEL_COUNT) % PIXEL_COUNT;
      if (dist < trail) {
        float fade = 1.0f - (float)dist / trail;
        fade = fade * fade;  // Quadratic falloff
        // Rainbow hue based on position
        float hue = (float)((i + patStep / 3) % PIXEL_COUNT) / PIXEL_COUNT;
        float h6 = hue * 6.0f;
        int sector = (int)h6;
        float frac = h6 - sector;
        uint8_t v = (uint8_t)(br * fade);
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
      } else {
        setPixel(i, RgbColor(0));
      }
    }
    strip.Show();
    patStep++;
  } else {
    // Fallback: slow comet (no beat, fixed speed)
    chasePos = (chasePos + 128) % (PIXEL_COUNT * 256);
    uint8_t headPix = chasePos / 256;
    for (int i = 0; i < PIXEL_COUNT; i++) {
      int dist = (headPix - i + PIXEL_COUNT) % PIXEL_COUNT;
      if (dist < 6) {
        float fade = 1.0f - (float)dist / 6.0f;
        uint8_t v = (uint8_t)(br * fade * fade);
        setPixel(i, RgbColor(v, v / 2, 0));  // Warm amber
      } else {
        setPixel(i, RgbColor(0));
      }
    }
    strip.Show();
  }
}

// ============================================================
// Ambient Pattern State
// ============================================================
unsigned long sunriseStartMs = 0;   // When sunrise pattern was activated

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

// Get circadian Kelvin from current hour (uses NTP)
// Night 9pm-6am: 2700K (warm), Morning 6-8am: 2700->5000K,
// Midday 8am-4pm: 5000->6500K->5000K, Evening 4-9pm: 5000->2700K
int getCircadianKelvin() {
  if (!isTimeValid()) return 4000;  // Default if no NTP
  int h = hour();
  int m = minute();
  int totalMin = h * 60 + m;  // Minutes since midnight

  if (totalMin < 360) return 2700;                                     // 0:00-6:00
  if (totalMin < 480) return 2700 + (totalMin - 360) * 2300 / 120;    // 6:00-8:00
  if (totalMin < 720) return 5000 + (totalMin - 480) * 1500 / 240;    // 8:00-12:00
  if (totalMin < 960) return 6500 - (totalMin - 720) * 1500 / 240;    // 12:00-16:00
  if (totalMin < 1260) return 5000 - (totalMin - 960) * 2300 / 300;   // 16:00-21:00
  return 2700;                                                          // 21:00-24:00
}

// ============================================================
// Ambient Pattern: Daylight
// ============================================================
// Circadian color temperature based on NTP time of day.
// Warm at night, cool at midday. Recalculates every second.
void patDaylight(int br) {
  unsigned long now = millis();
  if (now - lastPat < 1000) return;  // Update once per second
  lastPat = now;

  int kelvin = getCircadianKelvin();
  uint8_t r, g, b;
  kelvinToRgb(kelvin, r, g, b);
  // Scale by brightness
  r = (uint8_t)((uint16_t)r * br / 255);
  g = (uint8_t)((uint16_t)g * br / 255);
  b = (uint8_t)((uint16_t)b * br / 255);
  for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, RgbColor(r, g, b));
  strip.Show();
}

// ============================================================
// Ambient Pattern: Sunrise Alarm
// ============================================================
// 30-minute ramp from dark to warm white. Self-contained timer.
// 0-10min: dark->deep red, 10-20min: red->orange, 20-30min: orange->warm white.
// After 30min: holds at warm white.
void patSunrise(int br) {
  unsigned long now = millis();
  if (now - lastPat < 100) return;  // 10fps (slow changes)
  lastPat = now;

  unsigned long elapsed = now - sunriseStartMs;
  float progress = (float)elapsed / 1800000.0f;  // 0.0 to 1.0 over 30 min
  if (progress > 1.0f) progress = 1.0f;

  // Brightness ramp: 0 -> br over the 30 minutes
  uint8_t rampBr = (uint8_t)(progress * br);

  // Color temperature ramp: 1800K -> 5000K
  int kelvin = 1800 + (int)(progress * 3200);
  uint8_t r, g, b;
  kelvinToRgb(kelvin, r, g, b);
  r = (uint8_t)((uint16_t)r * rampBr / 255);
  g = (uint8_t)((uint16_t)g * rampBr / 255);
  b = (uint8_t)((uint16_t)b * rampBr / 255);

  for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, RgbColor(r, g, b));
  strip.Show();
}

// ============================================================
// Ambient Pattern: Fireplace
// ============================================================
// Multiple flame points with varying intensity. Warmer/wider than candle.
// Each pixel has independent flicker — creates a rich, dancing fire effect.
void patFireplace(int br) {
  unsigned long now = millis();
  if (now - lastPat < 40) return;  // 25fps
  lastPat = now;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    // Each pixel gets a unique flicker from its position + time
    uint8_t flicker = random(30, 100);
    uint8_t intensity = (uint8_t)((uint16_t)flicker * br / 100);
    // Flame palette: deep red to bright orange-yellow
    // Higher flicker = more orange/yellow, lower = deep red
    uint8_t r = intensity;
    uint8_t g = (uint8_t)((uint16_t)intensity * flicker / 180);  // 17%-56% green
    uint8_t b = (flicker > 85) ? (uint8_t)((uint16_t)intensity * (flicker - 85) / 200) : 0;
    setPixel(i, RgbColor(r, g, b));
  }
  strip.Show();
}

// ============================================================
// Ambient Pattern: Ocean
// ============================================================
// Deep blue base with turquoise waves and white foam sparkles.
// Multiple sine waves at different frequencies create organic motion.
void patOcean(int br) {
  unsigned long now = millis();
  if (now - lastPat < 33) return;  // 30fps
  lastPat = now;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    // Two overlapping waves at different speeds
    float wave1 = sinf((float)(i + patStep) * 6.28318f / 20.0f) * 0.5f + 0.5f;
    float wave2 = sinf((float)(i * 3 + patStep * 2) * 6.28318f / 37.0f) * 0.3f + 0.5f;
    float combined = wave1 * 0.6f + wave2 * 0.4f;

    // Deep blue base + turquoise highlights
    uint8_t b_val = (uint8_t)(br * (0.3f + combined * 0.7f));
    uint8_t g_val = (uint8_t)(br * combined * 0.5f);
    uint8_t r_val = 0;

    // Occasional white foam sparkle
    if (random(200) == 0) {
      r_val = br / 2; g_val = br / 2; b_val = br;
    }
    setPixel(i, RgbColor(r_val, g_val, b_val));
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Ambient Pattern: Forest
// ============================================================
// Lush green canopy with dappled golden sunbeams sweeping through.
// Base is varying shades of green, sunbeam is a warm gold that
// slowly travels around the ring.
void patForest(int br) {
  unsigned long now = millis();
  if (now - lastPat < 40) return;  // 25fps
  lastPat = now;

  // Sunbeam position (slow sweep around the ring)
  float beamCenter = (float)(patStep % 600) / 600.0f * PIXEL_COUNT;

  for (int i = 0; i < PIXEL_COUNT; i++) {
    // Base: varying greens with subtle sway
    float sway = sinf((float)(i * 2 + patStep) * 6.28318f / 25.0f) * 0.15f + 0.85f;
    uint8_t g_val = (uint8_t)(br * sway * 0.7f);
    uint8_t r_val = (uint8_t)(br * sway * 0.15f);  // Slight warm tint
    uint8_t b_val = (uint8_t)(br * sway * 0.05f);

    // Sunbeam: golden overlay near beam center (width ~8 pixels)
    float dist = (float)i - beamCenter;
    if (dist > PIXEL_COUNT / 2) dist -= PIXEL_COUNT;
    if (dist < -PIXEL_COUNT / 2) dist += PIXEL_COUNT;
    float beamIntensity = 1.0f - fabsf(dist) / 4.0f;
    if (beamIntensity > 0) {
      beamIntensity *= beamIntensity;  // Quadratic falloff
      uint8_t gold = (uint8_t)(br * beamIntensity * 0.6f);
      r_val = (r_val + gold > 255) ? 255 : r_val + gold;
      g_val = (g_val + gold * 3 / 4 > 255) ? 255 : g_val + gold * 3 / 4;
    }
    setPixel(i, RgbColor(r_val, g_val, b_val));
  }
  strip.Show();
  patStep++;
}

// ============================================================
// Timer/Countdown Pattern
// ============================================================
// LEDs represent remaining time. Fills green -> yellow -> red
// as time runs out. When done, flashes red then reverts to candle.
void patTimer(int br) {
  unsigned long now = millis();
  if (now - lastPat < 50) return;  // 20fps
  lastPat = now;

  unsigned long elapsed = now - timerStartMs;
  if (timerDurationMs == 0 || elapsed >= timerDurationMs) {
    // Timer finished — flash red for 3 seconds then revert
    if (elapsed < timerDurationMs + 3000) {
      bool flash = ((elapsed / 250) % 2) == 0;
      RgbColor c = flash ? RgbColor(br, 0, 0) : RgbColor(0, 0, 0);
      for (int i = 0; i < PIXEL_COUNT; i++) setPixel(i, c);
    } else {
      setMode(MODE_CANDLE);
      return;
    }
    strip.Show();
    return;
  }

  float progress = (float)elapsed / (float)timerDurationMs;  // 0.0 -> 1.0
  float remaining = 1.0f - progress;
  int litPixels = (int)(remaining * PIXEL_COUNT + 0.5f);

  for (int i = 0; i < PIXEL_COUNT; i++) {
    if (i < litPixels) {
      // Color gradient: green(100%) -> yellow(50%) -> red(0%)
      uint8_t r, g;
      if (remaining > 0.5f) {
        r = (uint8_t)((1.0f - (remaining - 0.5f) * 2.0f) * br);
        g = (uint8_t)(br * 0.8f);
      } else {
        r = (uint8_t)(br * 0.8f);
        g = (uint8_t)(remaining * 2.0f * br * 0.8f);
      }
      setPixel(i, RgbColor(r, g, 0));
    } else {
      setPixel(i, RgbColor(0, 0, 0));
    }
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
    beatDecay = 0; chasePos = 0; chaseSpeed = 512;
    sunriseStartMs = millis();
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
    case MODE_SPECIAL3: patSpecial3(br); break;
    case MODE_RAINBOW:  patRainbow(br); break;
    case MODE_CANDLE:   patCandle(br); break;
    case MODE_WAVE:     patWave(br); break;
    case MODE_SPARKLE:  patSparkle(br); break;
    case MODE_COLOR:    patSolid(RgbColor(customR, customG, customB)); break;
    case MODE_BEAT_PULSE: patBeatPulse(br); break;
    case MODE_SPECTRUM:   patSpectrum(br); break;
    case MODE_BEAT_CHASE: patBeatChase(br); break;
    case MODE_DAYLIGHT:   patDaylight(br); break;
    case MODE_SUNRISE:    patSunrise(br); break;
    case MODE_FIREPLACE:  patFireplace(br); break;
    case MODE_OCEAN:      patOcean(br); break;
    case MODE_FOREST:     patForest(br); break;
    case MODE_OFF:      break;
    case MODE_CUSTOM:     animTick(br); break;
    case MODE_TIMER:      patTimer(br); break;
    case MODE_COUNT:    break;  // Sentinel, not a real mode
  }

  modeChanged = false;
}
