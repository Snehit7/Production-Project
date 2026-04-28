/*
  AMS Monitor — ESP32
  OLED SSD1306 + BMP180 + MAX30102 + Buzzer + Button
  ──────────────────────────────────────────────────────────
  I2C  SDA: GPIO 21   SCL: GPIO 22
  Buzzer (active, +) : GPIO 25
  Button             : GPIO 32  (internal pull-up)

  Flow:
    1. Wait for finger on MAX30102
    2. Read for 20 s  → display alternates HR/SpO2 ↔ Altitude every 2 s
    3. "DONE :)" screen + 5 beeps; sensors stop
    4. After 2 s, show final HR reading
    5. Button single-click → toggle between HR and Altitude
       Double-click → emergency
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BMP085.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"
#include "heartRate.h"
#include <math.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ── WiFi + Server ─────────────────────────────────────────
const char* WIFI_SSID     = "snehit";
const char* WIFI_PASSWORD = "snehit123";
const char* SERVER_URL    = "http://192.168.1.68:5000/predict";
const char* EMERGENCY_URL = "http://192.168.1.68:5000/emergency";

// Reading window length (ms)
#define READING_DURATION_MS 20000
#define SWAP_INTERVAL_MS     2000   // alternate display every 2 s

// ── Pins ─────────────────────────────────────────────────
#define BUZZER_PIN 25
#define BUTTON_PIN 32

#define BUTTON_DEBOUNCE_MS  50
#define DOUBLE_CLICK_GAP_MS 400

// ── OLED ─────────────────────────────────────────────────
#define SCREEN_W 128
#define SCREEN_H  64
Adafruit_SSD1306 oled(SCREEN_W, SCREEN_H, &Wire, -1);

// ── BMP180 ───────────────────────────────────────────────
Adafruit_BMP085 bmp;
bool bmpOk = false;

// ── MAX30102 ─────────────────────────────────────────────
MAX30105 maxSensor;
#define BUF_LEN 100
uint32_t irBuf[BUF_LEN];
uint32_t redBuf[BUF_LEN];
int32_t  spo2Val   = 0;
int8_t   validSpo2 = 0;
int32_t  hrVal     = 0;
int8_t   validHR   = 0;

bool oledOk = false;
bool maxOk  = false;
bool wifiOk = false;

#define LED_AMP 0x1F

// ── Final values (frozen after reading) ──────────────────
int   finalSpo2 = 0;
int   finalHr   = 0;
float finalAlt  = 0;
float finalTemp = 0;

// ── Results display mode (0 = HR, 1 = Altitude) ──────────
int resultMode = 0;

// ── Button state ─────────────────────────────────────────
unsigned long lastButtonEdge = 0;
unsigned long firstClickTime = 0;
int           pendingClicks  = 0;
bool          buttonWasDown  = false;

// ─────────────────────────────────────────────────────────
//  OLED HELPERS
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
//  BUZZER
// ─────────────────────────────────────────────────────────
void buzz(int ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

// ─────────────────────────────────────────────────────────
//  WIFI
// ─────────────────────────────────────────────────────────
void connectWiFi() {
  cls(); centre("Connecting", 10, 1); centre("to WiFi...", 22, 1); oled.display();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(300);
  wifiOk = (WiFi.status() == WL_CONNECTED);
  cls();
  if (wifiOk) { centre("WiFi OK", 22, 1); }
  else        { centre("WiFi FAIL", 10, 1); centre("Offline mode", 26, 1); }
  oled.display();
  delay(1200);
}

// ─────────────────────────────────────────────────────────
//  LIVE READING POST  →  /predict
// ─────────────────────────────────────────────────────────
void postReading(int spo2, int hr, float altitude) {
  if (!wifiOk || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2500);
  char body[180];
  snprintf(body, sizeof(body),
           "{\"spo2_pct\":%d,\"heart_rate\":%d,\"altitude\":%.0f,"
           "\"ascent_rate\":0,\"hours_at_altitude\":0}",
           spo2, hr, altitude);
  http.POST(body);
  http.end();
}

// ─────────────────────────────────────────────────────────
//  EMERGENCY POST
// ─────────────────────────────────────────────────────────
void postEmergency() {
  if (!wifiOk || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(EMERGENCY_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);
  http.POST("{}");
  http.end();
}

void triggerEmergency() {
  cls();
  centre("EMERGENCY!", 10, 2);
  centre("Calling Mom", 34, 1);
  centre("Check phone", 48, 1);
  oled.display();
  for (int i = 0; i < 3; i++) { buzz(120); delay(100); }
  postEmergency();
  delay(1500);
}

// ─────────────────────────────────────────────────────────
//  BUTTON CHECK   (single → 1, double → 2)
// ─────────────────────────────────────────────────────────
int checkButton() {
  bool isDown = (digitalRead(BUTTON_PIN) == LOW);
  unsigned long now = millis();

  if (isDown && !buttonWasDown && now - lastButtonEdge > BUTTON_DEBOUNCE_MS) {
    lastButtonEdge = now;
    buttonWasDown  = true;
    if (pendingClicks == 0) { pendingClicks = 1; firstClickTime = now; }
    else if (pendingClicks == 1) pendingClicks = 2;
  }
  if (!isDown && buttonWasDown) buttonWasDown = false;

  if (pendingClicks > 0 && now - firstClickTime > DOUBLE_CLICK_GAP_MS) {
    int clicks = pendingClicks;
    pendingClicks = 0;
    if (clicks == 2) { triggerEmergency(); return 2; }
    else             { buzz(50); return 1; }
  }
  return 0;
}

// ─────────────────────────────────────────────────────────
//  DISPLAY HELPERS
// ─────────────────────────────────────────────────────────
void drawHR(int sp, int hr, int secsLeft) {
  cls();
  oled.setTextSize(1); oled.setCursor(0, 0); oled.print("SpO2:");
  oled.setTextSize(2); oled.setCursor(44, 0);
  if (sp > 0) { oled.print(sp); oled.setTextSize(1); oled.print("%"); }
  else        oled.print("---");

  if (secsLeft >= 0) {
    oled.setTextSize(1); oled.setCursor(108, 0); oled.print(secsLeft); oled.print("s");
  }
  hline(18);

  oled.setCursor(0, 22); oled.print("HR:");
  oled.setTextSize(2); oled.setCursor(30, 20);
  if (hr > 0) { oled.print(hr); oled.setTextSize(1); oled.print("bpm"); }
  else        oled.print("---");
  oled.display();
}

void drawAlt(float alt, float temp, int secsLeft) {
  cls();
  centre("ALTITUDE", 0, 1);
  if (secsLeft >= 0) {
    oled.setTextSize(1); oled.setCursor(108, 0); oled.print(secsLeft); oled.print("s");
  }
  hline(10);
  oled.setTextSize(2); oled.setCursor(0, 16);
  oled.print(alt, 0); oled.setTextSize(1); oled.print(" m");
  oled.setCursor(0, 42); oled.print("Temp : "); oled.print(temp, 1); oled.print(" C");
  oled.display();
}

// ── Smiley face (DONE screen) ───────────────────────────
void drawSmiley() {
  cls();
  // text
  centre("DONE", 4, 2);
  // face
  int cx = 64, cy = 42, r = 16;
  oled.drawCircle(cx, cy, r,     SSD1306_WHITE);
  oled.drawCircle(cx, cy, r - 1, SSD1306_WHITE);
  // eyes
  oled.fillCircle(cx - 6, cy - 4, 2, SSD1306_WHITE);
  oled.fillCircle(cx + 6, cy - 4, 2, SSD1306_WHITE);
  // smile — invert parabola so center is LOW, edges are HIGH = happy curve
  for (int x = -7; x <= 7; x++) {
    int y = (int)(0.10 * x * x);
    oled.drawPixel(cx + x, cy + 9 - y, SSD1306_WHITE);
    oled.drawPixel(cx + x, cy + 8 - y, SSD1306_WHITE);
  }
  oled.display();
}

// ─────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.setClock(100000);
  delay(300);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (oledOk) { oled.clearDisplay(); oled.display(); }

  bmpOk = bmp.begin();

  maxOk = maxSensor.begin(Wire, I2C_SPEED_FAST);
  if (maxOk) {
    maxSensor.setup(LED_AMP, 4, 2, 400, 411, 4096);
    maxSensor.setPulseAmplitudeRed(LED_AMP);
    maxSensor.setPulseAmplitudeIR(LED_AMP);
    maxSensor.setPulseAmplitudeGreen(0);
  }

  connectWiFi();
}

// ─────────────────────────────────────────────────────────
//  RESULTS LOOP — sensors stopped, button toggles HR/Alt
// ─────────────────────────────────────────────────────────
void resultsLoop() {
  // initial HR display
  drawHR(finalSpo2, finalHr, -1);
  resultMode = 0;

  while (true) {
    int evt = checkButton();
    if (evt == 1) {
      resultMode = (resultMode + 1) % 2;
      if (resultMode == 0) drawHR(finalSpo2, finalHr, -1);
      else                 drawAlt(finalAlt, finalTemp, -1);
    }
    delay(30);
  }
}

// ─────────────────────────────────────────────────────────
//  WAIT FOR FINGER
// ─────────────────────────────────────────────────────────
void waitForFinger() {
  bool dot = false;
  while (true) {
    if (checkButton() != 0) return;
    maxSensor.check();
    long ir = maxSensor.getIR();
    if (ir > 50000) break;
    cls();
    centre("Place finger", 14, 1);
    centre("on sensor",   28, 1);
    oled.setCursor(0, 52); oled.print("IR:"); oled.print(ir);
    oled.setCursor(96, 52); oled.print(dot ? ". . ." : "  . .");
    dot = !dot;
    oled.display();
    delay(250);
  }
  cls(); centre("Finger OK!", 24, 2); oled.display(); delay(600);
}

// ─────────────────────────────────────────────────────────
//  READING — 20 s, alternating display every 2 s
// ─────────────────────────────────────────────────────────
void runReading() {
  // Prime 100 samples
  cls(); centre("Priming...", 26, 1); oled.display();
  for (byte i = 0; i < BUF_LEN; i++) {
    unsigned long t0 = millis();
    while (!maxSensor.available()) {
      maxSensor.check();
      if (millis() - t0 > 2000) break;
    }
    redBuf[i] = maxSensor.getRed();
    irBuf[i]  = maxSensor.getIR();
    maxSensor.nextSample();
  }

  unsigned long readingStart = millis();
  unsigned long lastPost     = 0;
  while (millis() - readingStart < READING_DURATION_MS) {
    if (checkButton() != 0) return;
    maxSensor.check();

    // Shift + refill 25 samples
    for (byte i = 25; i < BUF_LEN; i++) {
      redBuf[i - 25] = redBuf[i];
      irBuf[i  - 25] = irBuf[i];
    }
    for (byte i = 75; i < BUF_LEN; i++) {
      unsigned long t0 = millis();
      while (!maxSensor.available()) {
        maxSensor.check();
        if (millis() - t0 > 2000) break;
      }
      redBuf[i] = maxSensor.getRed();
      irBuf[i]  = maxSensor.getIR();
      maxSensor.nextSample();
    }

    maxim_heart_rate_and_oxygen_saturation(
      irBuf, BUF_LEN, redBuf,
      &spo2Val, &validSpo2,
      &hrVal,   &validHR
    );

    bool spo2Ok = validSpo2 && spo2Val > 70 && spo2Val <= 100;
    bool hrOk   = validHR   && hrVal   > 30 && hrVal   < 220;

    // BMP read every cycle
    float pressure = bmpOk ? bmp.readPressure() / 100.0 : 0;
    float altitude = bmpOk ? 44330.0 * (1.0 - pow(pressure / 1013.25, 0.1903)) : 0;
    float temp     = bmpOk ? bmp.readTemperature() : 0;

    // Latch the last-good values
    if (spo2Ok) finalSpo2 = spo2Val;
    if (hrOk)   finalHr   = hrVal;
    if (bmpOk)  { finalAlt = altitude; finalTemp = temp; }

    int secsLeft = (READING_DURATION_MS - (millis() - readingStart)) / 1000;
    unsigned long elapsed = millis() - readingStart;
    int phase = (elapsed / SWAP_INTERVAL_MS) % 2;   // 0 = MAX, 1 = BMP

    if (phase == 0) {
      drawHR(spo2Ok ? spo2Val : 0, hrOk ? hrVal : 0, secsLeft);
    } else {
      drawAlt(altitude, temp, secsLeft);
    }

    Serial.printf("[READ %ds] SpO2:%d HR:%d Alt:%.0f T:%.1f\n",
                  secsLeft, spo2Val, hrVal, altitude, temp);

    // Push to server every 1.5 s when we have at least one valid vital
    if (millis() - lastPost > 1500 && (spo2Ok || hrOk)) {
      postReading(finalSpo2, finalHr, finalAlt);
      lastPost = millis();
    }
  }

  // One final post with the latched values once the window closes
  postReading(finalSpo2, finalHr, finalAlt);
}

// ─────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────
void loop() {
  waitForFinger();
  runReading();

  // Done — smiley + 5 beeps
  drawSmiley();
  for (int i = 0; i < 5; i++) { buzz(120); delay(380); }

  delay(2000);            // 2 s pause after smiley
  resultsLoop();          // never returns
}
