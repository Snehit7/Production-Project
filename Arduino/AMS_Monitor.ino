/*
  AMS Monitor — ESP32
  OLED SSD1306 + BMP180 + MAX30102 + Buzzer + Button
*/

#define BLYNK_TEMPLATE_ID "TMPL6a8RxwQIz"
#define BLYNK_TEMPLATE_NAME "AMS Heart Monitoring System"
#define BLYNK_AUTH_TOKEN "K9956YJulkzQGufJpV7_S6OXyet2hgee"

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
#include <BlynkSimpleEsp32.h>

// Virtual Pins for Blynk
#define VP_SPO2       V0
#define VP_HEART      V1
#define VP_ALTITUDE   V2
#define VP_RISK_LEVEL V3
#define VP_RISK_SCORE V4
#define VP_BUZZER     V5

// ── WiFi + Server ─────────────────────────────────────────
const char* WIFI_SSID     = "snehit";
const char* WIFI_PASSWORD = "snehit123";
const char* SERVER_URL    = "http://192.168.1.68:5000/predict";
const char* EMERGENCY_URL = "http://192.168.1.68:5000/emergency";

// Reading window length (ms)
#define READING_DURATION_MS 20000
#define SWAP_INTERVAL_MS     2000

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

// ── Results display mode ─────────────────────────────────
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
//  SEND TO SERVER + BLYNK
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

  // Send to Blynk
  Blynk.virtualWrite(VP_SPO2, spo2);
  Blynk.virtualWrite(VP_HEART, hr);
  Blynk.virtualWrite(VP_ALTITUDE, altitude);

  // Simple Risk for now
  String risk = (spo2 < 92 || hr > 110) ? "High" : "Medium";
  int riskScore = spo2 > 0 ? (100 - spo2 * 0.6) : 40;
  Blynk.virtualWrite(VP_RISK_LEVEL, risk);
  Blynk.virtualWrite(VP_RISK_SCORE, riskScore);
}

// ─────────────────────────────────────────────────────────
//  EMERGENCY
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
//  BUTTON CHECK
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
//  DISPLAY HELPERS (unchanged)
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

void drawSmiley() {
  cls();
  centre("DONE", 4, 2);
  int cx = 64, cy = 42, r = 16;
  oled.drawCircle(cx, cy, r, SSD1306_WHITE);
  oled.drawCircle(cx, cy, r - 1, SSD1306_WHITE);
  oled.fillCircle(cx - 6, cy - 4, 2, SSD1306_WHITE);
  oled.fillCircle(cx + 6, cy - 4, 2, SSD1306_WHITE);
  for (int x = -7; x <= 7; x++) {
    int y = (int)(0.10 * x * x);
    oled.drawPixel(cx + x, cy + 9 - y, SSD1306_WHITE);
    oled.drawPixel(cx + x, cy + 8 - y, SSD1306_WHITE);
  }
  oled.display();
}

// ─────────────────────────────────────────────────────────
//  WAIT FOR FINGER, READING, RESULTS (unchanged)
// ─────────────────────────────────────────────────────────
void waitForFinger() { /* your original code */ 
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

void runReading() { 
  // ... your original runReading() function remains the same ...
  // (I kept it short here, please keep your full original runReading function)
}

void resultsLoop() { 
  // ... your original resultsLoop() remains the same ...
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
  Blynk.begin(BLYNK_AUTH_TOKEN, WIFI_SSID, WIFI_PASSWORD);   // Blynk Start
}

// ─────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────
void loop() {
  Blynk.run();     // Important for Blynk to work

  waitForFinger();
  runReading();

  drawSmiley();
  for (int i = 0; i < 5; i++) { buzz(120); delay(380); }

  delay(2000);
  resultsLoop();
}
