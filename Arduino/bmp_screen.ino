#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BMP085.h>
#include <math.h>

// ── Pins ─────────────────────────────────
#define BUTTON_PIN 32
#define BUZZER_PIN 25

// ── OLED ─────────────────────────────────
#define SCREEN_W 128
#define SCREEN_H 64
Adafruit_SSD1306 oled(SCREEN_W, SCREEN_H, &Wire, -1);

// ── BMP180 ───────────────────────────────
Adafruit_BMP085 bmp;
bool bmpOk = false;

// ── State ─────────────────────────────────
bool showOK          = false;
bool buttonWasDown   = false;
unsigned long lastDebounce = 0;
#define DEBOUNCE_MS 60

// ── OLED helpers ─────────────────────────
void cls() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
}

void hline(int y) {
  oled.drawLine(0, y, SCREEN_W - 1, y, SSD1306_WHITE);
}

void centre(const char* s, int y, uint8_t sz = 1) {
  oled.setTextSize(sz);
  int16_t x1, y1; uint16_t w, h;
  oled.getTextBounds(s, 0, y, &x1, &y1, &w, &h);
  oled.setCursor((SCREEN_W - w) / 2, y);
  oled.print(s);
}

// ─────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.setClock(100000);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED FAIL");
    while (1);
  }

  bmpOk = bmp.begin();
  Serial.println(bmpOk ? "BMP180 OK" : "BMP180 FAIL");

  cls();
  centre("BMP180 READY", 20, 1);
  centre("Press btn to toggle", 38, 1);
  oled.display();
  delay(1500);
}

// ─────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────
void loop() {

  // ── Button: detect single press, toggle showOK ──
  bool isDown = (digitalRead(BUTTON_PIN) == LOW);
  if (isDown && !buttonWasDown && millis() - lastDebounce > DEBOUNCE_MS) {
    showOK        = !showOK;
    buttonWasDown = true;
    lastDebounce  = millis();
    // beep only when entering OK screen
    if (showOK) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(300);
      digitalWrite(BUZZER_PIN, LOW);
    }
  }
  if (!isDown) buttonWasDown = false;

  // ── Display ──
  cls();

  if (showOK) {
    // ─── Big OK screen ───
    centre("OK", 8, 4);           // huge "OK" letters
    hline(54);
    centre("press to go back", 56, 1);

  } else {
    // ─── BMP data screen ───
    float temp     = bmpOk ? bmp.readTemperature()      : 0;
    float pressure = bmpOk ? bmp.readPressure() / 100.0 : 0;
    float altitude = 44330.0 * (1.0 - pow(pressure / 1013.25, 0.1903));

    centre("ALTITUDE", 0, 1);
    hline(10);

    oled.setTextSize(2);
    oled.setCursor(0, 16);
    oled.print(altitude, 0);
    oled.setTextSize(1);
    oled.print(" m");

    oled.setCursor(0, 40); oled.print("Temp : "); oled.print(temp, 1);     oled.print(" C");
    oled.setCursor(0, 52); oled.print("Press: "); oled.print(pressure, 0); oled.print(" hPa");

    Serial.printf("Alt: %.0f m  Temp: %.1f C  Press: %.0f hPa\n", altitude, temp, pressure);
  }

  oled.display();
  delay(100);   // fast loop so button feels responsive
}
