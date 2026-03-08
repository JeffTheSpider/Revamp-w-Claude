// ============================================================
// Lamp Pin Scanner v2
// ============================================================
// Tests each GPIO pin to find which one drives the WS2812B
// LED strips. Tests BitBang pins first (serial stays alive),
// then GPIO3 DMA last (which kills serial).
//
// Watch the lamp LEDs and note which test lights them up.
// Serial output at 115200 shows current test.
//
// LED count: 24 (4 strips x 6 LEDs)
// ============================================================

#include <NeoPixelBus.h>

const uint16_t LED_COUNT = 24;

// Test pins: BitBang pins first (serial survives), DMA last
struct PinTest {
  uint8_t gpio;
  const char* label;
  bool isDMA;
};

const PinTest TEST_PINS[] = {
  { 2,  "GPIO2 (D4)",    false },
  { 0,  "GPIO0 (D3)",    false },
  { 4,  "GPIO4 (D2)",    false },
  { 5,  "GPIO5 (D1)",    false },
  { 14, "GPIO14 (D5)",   false },
  { 12, "GPIO12 (D6)",   false },
  { 13, "GPIO13 (D7)",   false },
  { 15, "GPIO15 (D8)",   false },
  { 1,  "GPIO1 (TX)",    false },
  { 3,  "GPIO3 (RX/DMA)", true },  // DMA last (kills serial)
};
const int NUM_TESTS = sizeof(TEST_PINS) / sizeof(TEST_PINS[0]);

// DMA strip (GPIO3 hardwired)
NeoPixelBus<NeoGrbFeature, NeoEsp8266Dma800KbpsMethod> stripDMA(LED_COUNT, 3);

// BitBang strip (dynamic pin)
NeoPixelBus<NeoGrbFeature, NeoEsp8266BitBang800KbpsMethod>* stripBB = nullptr;

int currentTest = -1;
bool dmaActive = false;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println(F("=== LAMP PIN SCANNER v2 ==="));
  Serial.println(F("24 LEDs, 5s per pin"));
  Serial.println(F("BitBang pins first, GPIO3 DMA last"));
  Serial.println();
}

void loop() {
  currentTest++;
  if (currentTest >= NUM_TESTS) {
    Serial.println(F("\n=== CYCLE COMPLETE, RESTARTING ===\n"));
    currentTest = 0;
    dmaActive = false;
  }

  const PinTest& t = TEST_PINS[currentTest];
  Serial.printf("[%d/%d] Testing %s ...\n", currentTest + 1, NUM_TESTS, t.label);

  if (t.isDMA) {
    Serial.println(F("  >> DMA mode - serial will die if this is the LED pin"));
    Serial.println(F("  >> If LEDs light up NOW, answer is GPIO3 DMA!"));
    Serial.flush();
    delay(100);
    dmaActive = true;
    stripDMA.Begin();
    showPattern(&stripDMA);
    delay(5000);
    stripDMA.ClearTo(RgbColor(0));
    stripDMA.Show();
  } else {
    if (stripBB) { delete stripBB; stripBB = nullptr; }
    stripBB = new NeoPixelBus<NeoGrbFeature, NeoEsp8266BitBang800KbpsMethod>(LED_COUNT, t.gpio);
    stripBB->Begin();
    showPattern(stripBB);
    delay(5000);
    stripBB->ClearTo(RgbColor(0));
    stripBB->Show();
    Serial.printf("  >> Pin %d done (no visual? moving on)\n", t.gpio);
  }

  delay(500); // Dark gap between tests
}

template<typename T>
void showPattern(T* strip) {
  // All red
  for (int i = 0; i < LED_COUNT; i++)
    strip->SetPixelColor(i, RgbColor(255, 0, 0));
  strip->Show();
  delay(1000);
  // All green
  for (int i = 0; i < LED_COUNT; i++)
    strip->SetPixelColor(i, RgbColor(0, 255, 0));
  strip->Show();
  delay(1000);
  // All blue
  for (int i = 0; i < LED_COUNT; i++)
    strip->SetPixelColor(i, RgbColor(0, 0, 255));
  strip->Show();
  delay(1000);
  // Strip colors: R, G, B, Y (one per 6-LED strip)
  RgbColor cols[] = { {255,0,0}, {0,255,0}, {0,0,255}, {255,255,0} };
  for (int i = 0; i < LED_COUNT; i++)
    strip->SetPixelColor(i, cols[i / 6]);
  strip->Show();
}
