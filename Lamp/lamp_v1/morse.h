#pragma once
// ============================================================
// Morse Code Encoder for Lamp
// ============================================================
// Non-blocking morse code playback on NeoPixel strips.
// Queues a message via morseStart(), then ticks in loop().
// Uses warm amber color for dots/dashes (cozy lamp aesthetic).
//
// Timing (ITU standard, scaled by WPM):
//   Dot:           1 unit
//   Dash:          3 units
//   Intra-char:    1 unit (between dots/dashes)
//   Inter-char:    3 units (between characters)
//   Inter-word:    7 units (between words)
//
// Included from lamp_v1.ino (single translation unit).
// ============================================================

// Morse lookup: A-Z, 0-9, space
// Each entry is a null-terminated string of '.' and '-'
static const char* const MORSE_TABLE[] = {
  ".-",     // A
  "-...",   // B
  "-.-.",   // C
  "-..",    // D
  ".",      // E
  "..-.",   // F
  "--.",    // G
  "....",   // H
  "..",     // I
  ".---",   // J
  "-.-",    // K
  ".-..",   // L
  "--",     // M
  "-.",     // N
  "---",    // O
  ".--.",   // P
  "--.-",   // Q
  ".-.",    // R
  "...",    // S
  "-",      // T
  "..-",    // U
  "...-",   // V
  ".--",    // W
  "-..-",   // X
  "-.--",   // Y
  "--..",   // Z
  "-----",  // 0
  ".----",  // 1
  "..---",  // 2
  "...--",  // 3
  "....-",  // 4
  ".....",  // 5
  "-....",  // 6
  "--...",  // 7
  "---..",  // 8
  "----.",  // 9
};

// === Morse State Machine ===
enum MorseState : uint8_t {
  MORSE_IDLE = 0,
  MORSE_ELEMENT_ON,    // Dot or dash lit
  MORSE_ELEMENT_GAP,   // Gap between dots/dashes within a character
  MORSE_CHAR_GAP,      // Gap between characters
  MORSE_WORD_GAP,      // Gap between words
  MORSE_DONE
};

// Forward declaration (defined below)
static void morseAdvance();

// === Morse Playback State ===
static char morseMessage[64];         // Queued message (uppercase)
static uint8_t morseCharIdx = 0;      // Current character position
static uint8_t morseElementIdx = 0;   // Current element within character
static MorseState morseState = MORSE_IDLE;
static unsigned long morseTimer = 0;  // When current state started
static unsigned long morseUnitMs = 100; // Duration of 1 unit (adjustable via WPM)
static bool morseLooping = false;     // Repeat message after done?
static uint8_t morseMessageLen = 0;   // Cached morseMessageLen
static RgbColor morseColor(200, 120, 0); // Warm amber default

// Look up morse code string for a character
// Returns nullptr for unsupported characters
static const char* morseLookup(char c) {
  if (c >= 'A' && c <= 'Z') return MORSE_TABLE[c - 'A'];
  if (c >= '0' && c <= '9') return MORSE_TABLE[26 + (c - '0')];
  return nullptr;  // space or unsupported
}

// Start morse code playback
// msg: text to encode (will be uppercased)
// wpm: words per minute (5-30, default 12)
// loop: repeat message continuously
void morseStart(const char* msg, int wpm = 12, bool loop = false) {
  // Copy and uppercase
  int len = strlen(msg);
  if (len > 62) len = 62;
  for (int i = 0; i < len; i++) {
    char c = msg[i];
    if (c >= 'a' && c <= 'z') c -= 32;
    morseMessage[i] = c;
  }
  morseMessage[len] = '\0';
  morseMessageLen = (uint8_t)len;

  // Calculate unit duration from WPM
  // Standard: "PARIS" = 50 units per word
  // 1 unit = 1200ms / WPM
  if (wpm < 5) wpm = 5;
  if (wpm > 30) wpm = 30;
  morseUnitMs = 1200 / wpm;

  morseCharIdx = 0;
  morseElementIdx = 0;
  morseLooping = loop;
  morseState = MORSE_IDLE;
  morseTimer = millis();

  // Advance to first element
  morseAdvance();
}

// Stop morse code playback
void morseStop() {
  morseState = MORSE_IDLE;
  morseMessage[0] = '\0';
  morseMessageLen = 0;
  morseLooping = false;
}

// Check if morse is currently playing
bool morseIsPlaying() {
  return morseState != MORSE_IDLE;
}

// Set all LEDs to a color (for morse on/off)
static void morseSetLeds(RgbColor c) {
  for (int i = 0; i < PIXEL_COUNT; i++) {
    strip.SetPixelColor(i, c);
  }
  showStrip();  // Use safe wrapper (defined in led_patterns.h)
}

// Advance to next morse element/character
static void morseAdvance() {
  if (morseMessage[0] == '\0') {
    morseState = MORSE_IDLE;
    return;
  }

  // Find next character
  while (morseCharIdx < morseMessageLen) {
    char c = morseMessage[morseCharIdx];

    if (c == ' ') {
      // Word gap
      morseState = MORSE_WORD_GAP;
      morseTimer = millis();
      morseCharIdx++;
      morseElementIdx = 0;
      return;
    }

    const char* code = morseLookup(c);
    if (code == nullptr) {
      // Unsupported character, skip
      morseCharIdx++;
      morseElementIdx = 0;
      continue;
    }

    if (morseElementIdx >= strlen(code)) {
      // Finished this character, move to next
      morseCharIdx++;
      morseElementIdx = 0;
      // Inter-character gap
      if (morseCharIdx < morseMessageLen) {
        morseState = MORSE_CHAR_GAP;
        morseTimer = millis();
        return;
      }
      continue;
    }

    // Start the element (dot or dash)
    morseState = MORSE_ELEMENT_ON;
    morseTimer = millis();
    morseSetLeds(morseColor);
    return;
  }

  // End of message
  if (morseLooping) {
    morseCharIdx = 0;
    morseElementIdx = 0;
    morseState = MORSE_WORD_GAP;  // Gap before repeat
    morseTimer = millis();
  } else {
    morseState = MORSE_DONE;
    morseSetLeds(RgbColor(0));
  }
}

// Tick the morse state machine (call from loop)
void morseTick() {
  if (morseState == MORSE_IDLE || morseState == MORSE_DONE) return;

  unsigned long elapsed = millis() - morseTimer;

  switch (morseState) {
    case MORSE_ELEMENT_ON: {
      // How long to stay lit?
      const char* code = morseLookup(morseMessage[morseCharIdx]);
      if (!code) { morseAdvance(); return; }
      char elem = code[morseElementIdx];
      unsigned long duration = (elem == '.') ? morseUnitMs : morseUnitMs * 3;
      if (elapsed >= duration) {
        morseSetLeds(RgbColor(0));  // Turn off
        morseElementIdx++;
        morseState = MORSE_ELEMENT_GAP;
        morseTimer = millis();
      }
      break;
    }

    case MORSE_ELEMENT_GAP:
      // 1 unit gap between elements
      if (elapsed >= morseUnitMs) {
        morseAdvance();
      }
      break;

    case MORSE_CHAR_GAP:
      // 3 unit gap between characters
      if (elapsed >= morseUnitMs * 3) {
        morseAdvance();
      }
      break;

    case MORSE_WORD_GAP:
      // 7 unit gap between words
      if (elapsed >= morseUnitMs * 7) {
        morseAdvance();
      }
      break;

    default:
      break;
  }
}

// Set morse playback color
void morseSetColor(uint8_t r, uint8_t g, uint8_t b) {
  morseColor = RgbColor(r, g, b);
}
