#pragma once
// ============================================================
// Custom Animation Playback Engine
// ============================================================
// Stores keyframe-based animations in RAM. Hub uploads keyframes
// via /api/animation/load, firmware interpolates between them
// at 30fps for smooth playback.
//
// Memory budget: ~2KB static buffer.
// Clock: 60 LEDs * 3 bytes = 180 bytes/keyframe = max 11 keyframes.
// Animations loop automatically.
// ============================================================

// Maximum keyframes in a single animation
#define ANIM_MAX_KEYFRAMES  12
// Bytes per keyframe = PIXEL_COUNT * 3 (RGB per LED)
#define ANIM_FRAME_SIZE     (PIXEL_COUNT * 3)

// Keyframe: a snapshot of all LEDs at a specific time offset
struct AnimKeyframe {
  uint16_t timeMs;                    // Time offset from animation start
  uint8_t  pixels[ANIM_FRAME_SIZE];   // RGB data: [R0,G0,B0, R1,G1,B1, ...]
};

// Animation state
struct AnimState {
  bool loaded;                                  // Animation loaded and ready
  bool playing;                                 // Currently playing
  uint8_t keyframeCount;                        // Number of keyframes
  uint16_t totalDurationMs;                     // Total animation duration
  bool loop;                                    // Loop when complete
  unsigned long startTime;                      // millis() when playback started
  unsigned long lastFrame;                      // Last render timestamp
  AnimKeyframe keyframes[ANIM_MAX_KEYFRAMES];   // Keyframe data
};

static AnimState anim = { false, false, 0, 0, true, 0, 0, {} };

bool animIsLoaded() { return anim.loaded; }
bool animIsPlaying() { return anim.playing; }

// Clear animation data
void animClear() {
  anim.loaded = false;
  anim.playing = false;
  anim.keyframeCount = 0;
  anim.totalDurationMs = 0;
  logInfo("Animation cleared");
}

// Start playback (must be loaded first)
void animPlay() {
  if (!anim.loaded || anim.keyframeCount < 2) return;
  anim.playing = true;
  anim.startTime = millis();
  anim.lastFrame = 0;
  logInfo("Animation play (" + String(anim.keyframeCount) + " keyframes, " +
          String(anim.totalDurationMs) + "ms)");
}

// Stop playback
void animStop() {
  anim.playing = false;
  logInfo("Animation stopped");
}

// ============================================================
// Animation Tick — renders interpolated frame
// ============================================================
// Returns true if animation is rendering (caller should skip normal patterns).
bool animTick(int br) {
  if (!anim.playing || !anim.loaded) return false;

  // Frame rate gate: ~30fps
  unsigned long now = millis();
  if (now - anim.lastFrame < 33) return true;
  anim.lastFrame = now;

  // Calculate current position in animation
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

  // Find surrounding keyframes for interpolation
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

  // Calculate interpolation factor (0.0 - 1.0)
  float t = 0.0f;
  uint16_t spanMs = anim.keyframes[kfB].timeMs - anim.keyframes[kfA].timeMs;
  if (spanMs > 0) {
    t = (float)(elapsed - anim.keyframes[kfA].timeMs) / (float)spanMs;
    if (t > 1.0f) t = 1.0f;
    if (t < 0.0f) t = 0.0f;
  }

  // Interpolate each LED between keyframes A and B
  const uint8_t* pixA = anim.keyframes[kfA].pixels;
  const uint8_t* pixB = anim.keyframes[kfB].pixels;
  for (int i = 0; i < PIXEL_COUNT; i++) {
    int idx = i * 3;
    uint8_t r = (uint8_t)(pixA[idx]     + (int16_t)(pixB[idx]     - pixA[idx])     * t);
    uint8_t g = (uint8_t)(pixA[idx + 1] + (int16_t)(pixB[idx + 1] - pixA[idx + 1]) * t);
    uint8_t b = (uint8_t)(pixA[idx + 2] + (int16_t)(pixB[idx + 2] - pixA[idx + 2]) * t);
    // Apply brightness
    r = (uint16_t)r * br / 255;
    g = (uint16_t)g * br / 255;
    b = (uint16_t)b * br / 255;
    strip.SetPixelColor(i, RgbColor(r, g, b));
  }
  strip.Show();
  return true;
}

// ============================================================
// Load animation from HTTP POST body (JSON)
// ============================================================
// Expected format: keyframes as comma-separated hex blocks
// Each keyframe: timeMs,R0G0B0R1G1B1... (hex encoded pixel data)
// This parser handles the compact format sent by the Hub.
//
// JSON format from Hub:
// { "keyframes": [ { "t": 0, "d": "FF0000FF0000..." }, ... ], "loop": true }
//
// We parse this manually to avoid ArduinoJson dependency.
// The Hub sends keyframes one at a time via /api/animation/keyframe
// to stay within ESP8266 HTTP body size limits.
//
// Individual keyframe endpoint is simpler and more reliable.
