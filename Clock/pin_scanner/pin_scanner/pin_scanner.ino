#include <Adafruit_NeoPixel.h>
#include <NeoPixelBus.h>

// Final test: GPIO3 confirmed as data pin
// Try every possible protocol/method combination on GPIO3
// NO serial to avoid GPIO3 conflict

#define NUM_LEDS 60
#define PIN 3

// Adafruit NeoPixel - multiple protocol variations
Adafruit_NeoPixel strip1(NUM_LEDS, PIN, NEO_GRB + NEO_KHZ800);  // WS2812B standard
Adafruit_NeoPixel strip2(NUM_LEDS, PIN, NEO_GRB + NEO_KHZ400);  // WS2811 (400KHz)
Adafruit_NeoPixel strip3(NUM_LEDS, PIN, NEO_RGB + NEO_KHZ800);  // RGB order
Adafruit_NeoPixel strip4(NUM_LEDS, PIN, NEO_BRG + NEO_KHZ800);  // BRG order

// NeoPixelBus DMA (hardwired to GPIO3)
NeoPixelBus<NeoGrbFeature, NeoEsp8266Dma800KbpsMethod> stripDma(NUM_LEDS);

void flashStrip(Adafruit_NeoPixel &s) {
  s.begin();
  s.setBrightness(255);
  // All white - maximum visibility
  for (int i = 0; i < NUM_LEDS; i++) {
    s.setPixelColor(i, s.Color(255, 255, 255));
  }
  s.show();
  delay(3000);
  s.clear();
  s.show();
  delay(1000);
}

void setup() {
  delay(2000);

  // Test 1: Standard WS2812B (GRB 800KHz) via Adafruit
  flashStrip(strip1);

  // Test 2: WS2811 (GRB 400KHz) via Adafruit
  flashStrip(strip2);

  // Test 3: RGB 800KHz via Adafruit
  flashStrip(strip3);

  // Test 4: BRG 800KHz via Adafruit
  flashStrip(strip4);

  // Test 5: NeoPixelBus DMA method (GPIO3 via I2S hardware)
  stripDma.Begin();
  for (int i = 0; i < NUM_LEDS; i++) {
    stripDma.SetPixelColor(i, RgbColor(255, 255, 255));
  }
  stripDma.Show();
  delay(3000);
  for (int i = 0; i < NUM_LEDS; i++) {
    stripDma.SetPixelColor(i, RgbColor(0, 0, 0));
  }
  stripDma.Show();
  delay(1000);

  // Test 6: Just toggle GPIO3 rapidly as raw output
  // This will create visible flicker if ANY LEDs respond to the signal
  pinMode(PIN, OUTPUT);
  for (int j = 0; j < 5000; j++) {
    digitalWrite(PIN, HIGH);
    delayMicroseconds(5);
    digitalWrite(PIN, LOW);
    delayMicroseconds(5);
  }
  delay(2000);
}

void loop() {
  // Repeat all tests forever
  setup();
}
