/*
             : GPIO 32  (internal pull-up)

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

// ╔═════════════════════════════════════════════════════════════════════╗
// ║                        ▼  CHECKPOINT 1  ▼                            ║
// ║                                                                      ║
// ║   DEMO_MODE — high-risk simulator                                    ║
// ║                                                                      ║
// ║   When `true`, the firmware ignores the BMP180 + MAX30102 readings   ║
// ║   and FABRICATES dangerous-looking data (altitude 4–5 km, SpO2       ║
// ║   80–94 %, elevated heart rate). This lets you exercise the          ║
// ║   Moderate / High / Severe risk paths in the AMS app while sitting   ║
// ║   in Kathmandu (1 340 m), where the real sensors only see Low risk.  ║
// ║                                                                      ║
// ║   Flip this to `false` for actual climbing / lab use.                ║
// ║                                                                      ║
// ╚═════════════════════════════════════════════════════════════════════╝
#define DEMO_MODE  true    

// ── WiFi + Server ─────────────────────────────────────────
const char* WIFI_SSID     = "your ssid";
const char* WIFI_PASSWORD = "your password";
const char* SERVER_URL          = "http://192.168.x.x:5000/predict";
const char* EMERGENCY_URL       = "http://192.168.x.x:5000/emergency";
const char* SESSION_START_URL   = "http://192.168.x.x:5000/session/start";
const char* SESSION_END_URL     = "http://192.168.x.x:5000/session/end";

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

// 0=Low  1=Medium  2=High  3=Severe
// Mirrors the rule_based_predict() logic in flask_api.py so the offline
// OLED result matches what the server would compute.
int calcRisk(int spo2, int hr, float altitude) {
  // Primary: SpO2 (most important AMS indicator)
  int risk = 0;
  if      (spo2 < 85) risk = 3;
  else if (spo2 < 90) risk = 2;
  else if (spo2 < 94) risk = 1;

  // Altitude modifier
  if      (altitude > 5500 && risk < 3) risk = 3;
  else if (altitude > 4500 && risk < 2) risk = 2;
  else if (altitude > 3500 && risk < 1) risk = 1;

  // Heart-rate modifier (tachycardia = body compensating for low O2)
  if (hr > 110 && spo2 < 94 && risk < 1) risk = 1;
  if (hr > 130 && spo2 < 90 && risk < 2) risk = 2;

  return risk;
}

// Normal completion — 5 pleasant beeps
void buzzDone() {
  for (int i = 0; i < 5; i++) { buzz(120); delay(380); }
}

// High risk — 3 rapid bursts of 5 short beeps
void buzzHighRisk() {
  for (int burst = 0; burst < 3; burst++) {
    for (int i = 0; i < 5; i++) { buzz(55); delay(50); }
    delay(260);
  }
}

// Severe — 20 frantic beeps then 3 long alarm blasts
void buzzSevere() {
  for (int i = 0; i < 20; i++) { buzz(65); delay(40); }
  delay(140);
  for (int i = 0; i < 3; i++)  { buzz(450); delay(160); }
}

// ─────────────────────────────────────────────────────────
//  WIFI
// ─────────────────────────────────────────────────────────
void connectWiFi() {
  cls();
  centre("Connecting", 6, 2);     // size 2 — clearly readable
  centre("to WiFi...", 28, 1);
  oled.display();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(300);
  wifiOk = (WiFi.status() == WL_CONNECTED);
  cls();
  if (wifiOk) {
    centre("WiFi OK", 24, 2);
  } else {
    centre("WiFi FAIL", 8, 2);
    centre("Offline mode", 32, 1);
  }
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
//  SESSION SYNC  (tells the app to enter/exit "reading" state)
// ─────────────────────────────────────────────────────────
void postSessionStart() {
  if (!wifiOk || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SESSION_START_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2500);
  http.POST("{}");
  http.end();
}

void postSessionEnd(int spo2, int hr, float altitude) {
  if (!wifiOk || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SESSION_END_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2500);
  char body[180];
  snprintf(body, sizeof(body),
           "{\"spo2_pct\":%d,\"heart_rate\":%d,\"altitude\":%.0f}",
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
  centre("EMERGENCY!", 4, 2);
  centre("Calling Mom", 28, 2);
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

  // ── Top label + countdown ────────────────────────────
  oled.setTextSize(1); oled.setCursor(0, 0); oled.print("SpO2");
  if (secsLeft >= 0) {
    char tb[8]; snprintf(tb, sizeof(tb), "%ds", secsLeft);
    oled.setCursor(128 - (int)strlen(tb) * 6, 0); oled.print(tb);
  }
  hline(9);

  // ── Big SpO2 value (size 3 = 24 px tall) ────────────
  oled.setTextSize(3);
  if (sp > 0) {
    char sv[8]; snprintf(sv, sizeof(sv), "%d%%", sp);
    int16_t x1, y1; uint16_t w, h;
    oled.getTextBounds(sv, 0, 12, &x1, &y1, &w, &h);
    oled.setCursor((SCREEN_W - w) / 2, 12);
    oled.print(sv);
  } else {
    oled.setCursor(46, 12); oled.print("--");
  }
  hline(38);

  // ── HR row ───────────────────────────────────────────
  oled.setTextSize(1); oled.setCursor(0, 42); oled.print("HR");
  oled.setTextSize(2); oled.setCursor(22, 41);
  if (hr > 0) { oled.print(hr); oled.setTextSize(1); oled.print("bpm"); }
  else        { oled.print("--"); }

  oled.display();
}

void drawAlt(float alt, float temp, int secsLeft) {
  cls();

  // ── Top label + countdown ────────────────────────────
  oled.setTextSize(1); oled.setCursor(0, 0); oled.print("Altitude");
  if (secsLeft >= 0) {
    char tb[8]; snprintf(tb, sizeof(tb), "%ds", secsLeft);
    oled.setCursor(128 - (int)strlen(tb) * 6, 0); oled.print(tb);
  }
  hline(9);

  // ── Big altitude value (size 3) + " m" (size 2) ─────
  oled.setTextSize(3); oled.setCursor(2, 12);
  oled.print((int)(alt + 0.5f));
  oled.setTextSize(2); oled.print(" m");

  // ── Temperature (size 1 — fits on one line) ──────────
  oled.setTextSize(1); oled.setCursor(2, 50);
  oled.print("Temp: "); oled.print(temp, 1); oled.print(" C");

  oled.display();
}

// ── Smiley face (Low/Medium risk DONE screen) ──────────
void drawSmiley() {
  cls();
  centre("DONE", 4, 2);
  int cx = 64, cy = 42, r = 16;
  oled.drawCircle(cx, cy, r,     SSD1306_WHITE);
  oled.drawCircle(cx, cy, r - 1, SSD1306_WHITE);
  // eyes
  oled.fillCircle(cx - 6, cy - 4, 2, SSD1306_WHITE);
  oled.fillCircle(cx + 6, cy - 4, 2, SSD1306_WHITE);
  // smile — inverted parabola → center LOW, edges HIGH = happy curve
  for (int x = -7; x <= 7; x++) {
    int y = (int)(0.10 * x * x);
    oled.drawPixel(cx + x, cy + 9 - y, SSD1306_WHITE);
    oled.drawPixel(cx + x, cy + 8 - y, SSD1306_WHITE);
  }
  oled.display();
}

// ── Sad face (High / Severe risk) ──────────────────────
void drawSadFace(bool severe) {
  cls();
  // Risk label at top (size 2, bold-looking)
  if (severe) centre("SEVERE!", 4, 2);
  else        centre("HIGH RISK", 4, 2);

  int cx = 64, cy = 44, r = 16;
  // Double-ring face outline
  oled.drawCircle(cx, cy, r,     SSD1306_WHITE);
  oled.drawCircle(cx, cy, r - 1, SSD1306_WHITE);

  // Worried / angled eyebrows (slanting inward)
  oled.drawLine(cx - 9, cy - 9, cx - 3, cy - 7, SSD1306_WHITE);
  oled.drawLine(cx + 3, cy - 7, cx + 9, cy - 9, SSD1306_WHITE);

  // Eyes
  oled.fillCircle(cx - 6, cy - 4, 2, SSD1306_WHITE);
  oled.fillCircle(cx + 6, cy - 4, 2, SSD1306_WHITE);

  // Frown — parabola curving DOWN at edges (opposite of smiley)
  for (int x = -7; x <= 7; x++) {
    int y = (int)(0.10 * x * x);
    oled.drawPixel(cx + x, cy + 5 + y, SSD1306_WHITE);
    oled.drawPixel(cx + x, cy + 6 + y, SSD1306_WHITE);
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
    // "Place" / "finger" big enough to read at a glance
    centre("Place",  4, 2);
    centre("finger", 24, 2);
    // Small IR debug row at the bottom
    oled.setTextSize(1);
    oled.setCursor(0, 52); oled.print("IR:"); oled.print(ir);
    oled.setCursor(96, 52); oled.print(dot ? ". . ." : "  . .");
    dot = !dot;
    oled.display();
    delay(250);
  }
  cls(); centre("Finger OK!", 24, 2); oled.display(); delay(600);

  // Tell the AMS app a reading session has begun. The app will swap its
  // Track tab into "Reading…" mode with a 20 s countdown.
  postSessionStart();
}

// ╔═════════════════════════════════════════════════════════════════════╗
// ║                        ▼  CHECKPOINT 2  ▼                            ║
// ╚═════════════════════════════════════════════════════════════════════╝
#if DEMO_MODE
void generateDemoReading(unsigned long elapsedMs,
                         int *outSpo2, int *outHr, float *outAlt, float *outTemp) {
  // Progress fraction 0.0 → 1.0 over the 20-second reading window
  float p = (float)elapsedMs / (float)READING_DURATION_MS;
  if (p < 0.0f) p = 0.0f;
  if (p > 1.0f) p = 1.0f;

  // Altitude sweeps 4 200 m → 5 100 m
  float alt = 4200.0f + (5100.0f - 4200.0f) * p;

  // SpO2 sweeps 94 % → 81 % with small jitter
  float spo2 = 94.0f - (94.0f - 81.0f) * p;
  spo2 += ((random(0, 200) - 100) / 100.0f) * 1.8f;     // ±1.8 %
  if (spo2 < 80.0f)  spo2 = 80.0f;
  if (spo2 > 99.0f)  spo2 = 99.0f;

  // HR climbs 92 → 120 bpm with jitter
  float hr = 92.0f + (120.0f - 92.0f) * p;
  hr += (random(0, 200) - 100) / 100.0f * 4.0f;          // ±4 bpm
  if (hr < 50.0f)  hr = 50.0f;
  if (hr > 180.0f) hr = 180.0f;

  // Temperature drops a touch as we climb
  float temp = 12.0f - p * 6.0f;                          // 12 °C → 6 °C

  *outSpo2 = (int)(spo2 + 0.5f);
  *outHr   = (int)(hr   + 0.5f);
  *outAlt  = alt;
  *outTemp = temp;
}
#endif  // DEMO_MODE

// ─────────────────────────────────────────────────────────
//  READING — 20 s, alternating display every 2 s
// ─────────────────────────────────────────────────────────
void runReading() {
  // ────────────────────────────────────────────────────────────────────
  // PRIMING — only relevant for the real MAX30102. In DEMO_MODE we skip
  // it entirely because there's no real signal to prime against.
  // ────────────────────────────────────────────────────────────────────
#if !DEMO_MODE
  // ─── REAL SENSOR PATH — priming 100 samples from MAX30102 ──────────
  cls(); centre("Priming...", 24, 2); oled.display();
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
#else
  // ─── DEMO PATH — show a friendly priming screen so the UX matches ──
  cls(); centre("DEMO MODE",   2, 2);
         centre("simulating",  22, 2);
         centre("altitude...", 48, 1); oled.display();   // size 1 — 11 chars fits 128 px
  delay(800);
  randomSeed(micros());
#endif

  unsigned long readingStart = millis();
  unsigned long lastPost     = 0;
  while (millis() - readingStart < READING_DURATION_MS) {
    if (checkButton() != 0) return;

    int   readSpo2 = 0, readHr = 0;
    bool  spo2Ok = false, hrOk = false;
    float altitude = 0, temp = 0;

    // ════════════════════════════════════════════════════════════════
    //                     ▼  CHECKPOINT 3  ▼
    // The two reading paths live side-by-side. Exactly ONE compiles
    // depending on DEMO_MODE in CHECKPOINT 1.
    // ════════════════════════════════════════════════════════════════

#if !DEMO_MODE
    // ───── REAL SENSOR PATH ─────
    // Real MAX30102 + BMP180 readings. This is what you want when the
    // device is actually strapped to a trekker climbing a mountain.
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

    spo2Ok = validSpo2 && spo2Val > 70 && spo2Val <= 100;
    hrOk   = validHR   && hrVal   > 30 && hrVal   < 220;
    readSpo2 = spo2Val;
    readHr   = hrVal;

    // BMP read every cycle
    float pressure = bmpOk ? bmp.readPressure() / 100.0 : 0;
    altitude = bmpOk ? 44330.0 * (1.0 - pow(pressure / 1013.25, 0.1903)) : 0;
    temp     = bmpOk ? bmp.readTemperature() : 0;
#else
    // ───── DEMO PATH ─────
    // Synthetic high-risk readings — see CHECKPOINT 2 for the curve.
    // Both vitals are always considered "valid" so the AMS app sees a
    // continuous stream. Real sensors are not touched.
    generateDemoReading(millis() - readingStart,
                        &readSpo2, &readHr, &altitude, &temp);
    spo2Ok = true;
    hrOk   = true;
#endif

    // ────────────────────────────────────────────────────────────────
    // Beyond this point, both paths feed into the SAME pipeline:
    //   - latch values
    //   - alternate the OLED display
    //   - POST to Flask /predict
    // ────────────────────────────────────────────────────────────────

    if (spo2Ok) finalSpo2 = readSpo2;
    if (hrOk)   finalHr   = readHr;
#if DEMO_MODE
    finalAlt = altitude; finalTemp = temp;     // BMP irrelevant in demo
#else
    if (bmpOk) { finalAlt = altitude; finalTemp = temp; }
#endif

    int secsLeft = (READING_DURATION_MS - (millis() - readingStart)) / 1000;
    unsigned long elapsed = millis() - readingStart;
    int phase = (elapsed / SWAP_INTERVAL_MS) % 2;   // 0 = HR/SpO2, 1 = Alt

    if (phase == 0) {
      drawHR(spo2Ok ? readSpo2 : 0, hrOk ? readHr : 0, secsLeft);
    } else {
      drawAlt(altitude, temp, secsLeft);
    }

#if DEMO_MODE
    Serial.printf("[DEMO %ds] SpO2:%d HR:%d Alt:%.0f T:%.1f  (high-risk sim)\n",
                  secsLeft, readSpo2, readHr, altitude, temp);
#else
    Serial.printf("[READ %ds] SpO2:%d HR:%d Alt:%.0f T:%.1f\n",
                  secsLeft, readSpo2, readHr, altitude, temp);
#endif

    // Push to server every 1.5 s when we have at least one valid vital
    if (millis() - lastPost > 1500 && (spo2Ok || hrOk)) {
      postReading(finalSpo2, finalHr, finalAlt);
      lastPost = millis();
    }

#if DEMO_MODE
    // Real sensor loop is paced by I/O; demo loop needs a small delay
    // so we don't spam the OLED + WiFi at hundreds of Hz.
    delay(40);
#endif
  }

  // One final post with the latched values once the window closes
  postReading(finalSpo2, finalHr, finalAlt);

  // Mark the session complete so the app can reveal the result block and
  // freeze its countdown at 0.
  postSessionEnd(finalSpo2, finalHr, finalAlt);
}

// ─────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────
void loop() {
  waitForFinger();
  runReading();

  // Pick face + buzzer pattern based on risk
  int riskLevel = calcRisk(finalSpo2, finalHr, finalAlt);
  if (riskLevel >= 3) {
    drawSadFace(true);    // "SEVERE!" + frown
    buzzSevere();         // 20 frantic beeps → 3 long alarm blasts
  } else if (riskLevel >= 2) {
    drawSadFace(false);   // "HIGH RISK" + frown
    buzzHighRisk();       // 3 rapid-fire bursts
  } else {
    drawSmiley();         // "DONE :)" smiley
    buzzDone();           // 5 pleasant beeps
  }

  delay(2000);
  resultsLoop();          // never returns
}
