#pragma once
// ============================================================
// Custom Animation Playback Engine (Lamp)
// ============================================================
// Stores keyframe-based animations in RAM. Hub uploads keyframes
// via /api/animation/keyframe, firmware interpolates between them
// at 30fps for smooth playback. Uses showStrip() for multi-GPIO.
//
// Memory budget: ~2KB static buffer.
// Lamp: 24 LEDs * 3 bytes = 72 bytes/keyframe = max 28 keyframes.
// ============================================================

#define ANIM_MAX_KEYFRAMES  28
#define ANIM_FRAME_SIZE     (PIXEL_COUNT * 3)

struct AnimKeyframe {
  uint16_t timeMs;
  uint8_t  pixels[ANIM_FRAME_SIZE];
};

struct AnimState {
  bool loaded;
  bool playing;
  uint8_t keyframeCount;
  uint16_t totalDurationMs;
  bool loop;
  unsigned long startTime;
  unsigned long lastFrame;
  AnimKeyframe keyframes[ANIM_MAX_KEYFRAMES];
};

static AnimState anim = { false, false, 0, 0, true, 0, 0, {} };

bool animIsLoaded() { return anim.loaded; }
bool animIsPlaying() { return anim.playing; }

void animClear() {
  anim.loaded = false;
  anim.playing = false;
  anim.keyframeCount = 0;
  anim.totalDurationMs = 0;
  logInfo("Animation cleared");
}

void animPlay() {
  if (!anim.loaded || anim.keyframeCount < 2) return;
  anim.playing = true;
  anim.startTime = millis();
  anim.lastFrame = 0;
  logInfo("Animation play (" + String(anim.keyframeCount) + " keyframes, " +
          String(anim.totalDurationMs) + "ms)");
}

void animStop() {
  anim.playing = false;
  logInfo("Animation stopped");
}

// Returns true if animation is rendering (caller skips normal patterns).
bool animTick(int br) {
  if (!anim.playing || !anim.loaded) return false;

  unsigned long now = millis();
  if (now - anim.lastFrame < 33) return true;
  anim.lastFrame = now;

  unsigned long elapsed = now - anim.startTime;
  if (elapsed >= anim.totalDurationMs) {
    if (anim.loop) {
      anim.startTime = now;
      elapsed = 0;
    } else {
      animStop();
      return false;
    }
  }

  // Find surrounding keyframes
  uint8_t kfA = 0, kfB = 1;
  for (uint8_t i = 1; i < anim.keyframeCount; i++) {
    if (anim.keyframes[i].timeMs > elapsed) {
      kfB = i;
      kfA = i - 1;
      break;
    }
    kfA = i;
    kfB = (i + 1 < anim.keyframeCount) ? i + 1 : i;
  }

  // Interpolation factor
  float t = 0.0f;
  uint16_t spanMs = anim.keyframes[kfB].timeMs - anim.keyframes[kfA].timeMs;
  if (spanMs > 0) {
    t = (float)(elapsed - anim.keyframes[kfA].timeMs) / (float)spanMs;
    if (t > 1.0f) t = 1.0f;
    if (t < 0.0f) t = 0.0f;
  }

  // Interpolate each LED
  const uint8_t* pixA = anim.keyframes[kfA].pixels;
  const uint8_t* pixB = anim.keyframes[kfB].pixels;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    int idx = i * 3;
    uint8_t r = (uint8_t)(pixA[idx]     + (int16_t)(pixB[idx]     - pixA[idx])     * t);
    uint8_t g = (uint8_t)(pixA[idx + 1] + (int16_t)(pixB[idx + 1] - pixA[idx + 1]) * t);
    uint8_t b = (uint8_t)(pixA[idx + 2] + (int16_t)(pixB[idx + 2] - pixA[idx + 2]) * t);
    r = (uint16_t)r * br / 255;
    g = (uint16_t)g * br / 255;
    b = (uint16_t)b * br / 255;
    strip.SetPixelColor(i, RgbColor(r, g, b));
  }
  showStrip();  // Lamp multi-GPIO output
  return true;
}
