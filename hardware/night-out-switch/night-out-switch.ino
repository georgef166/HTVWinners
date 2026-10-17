// Night Out Switch: the clip-on hardware Switch (Arduino Uno R4 WiFi).
//
//   Touch sensor  check in ("I'm OK") without unlocking the phone
//   Joystick      gesture PIN to cancel an alarm: up=1 right=2 down=3 left=4, press to send
//   NFC reader    tap the home tag by the front door to end the night
//   LED + buzzer  armed / nudge / alarm, even if the phone is dead or in a bag
//   BMP280        temperature + pressure readings for the prediction engine (cold exposure)
//   LED matrix    icons: fuse bar while armed, ? on nudge, ! on alarm, check when OK
//
// Talks to the Night Out Switch server over WiFi. See hardware/README.md for wiring.

#include <WiFiS3.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_BMP280.h>
#include "Arduino_LED_Matrix.h"
#include "arduino_secrets.h"  // WIFI_SSID, WIFI_PASS, SERVER_HOST, SERVER_PORT, SWITCH_KEY

// ---------- Pins (common kit parts; change here if yours differ) ----------
const int PIN_TOUCH = 4;      // TTP223 SIG (HIGH when touched)
const int PIN_STATUS_LED = 6;        // LED through a 220 ohm resistor (PWM pin)
const int PIN_BUZZER = 8;     // passive buzzer (an active one works too, just one pitch)
const int PIN_JOY_X = A0;     // KY-023 VRx
const int PIN_JOY_Y = A1;     // KY-023 VRy
const int PIN_JOY_SW = 2;     // KY-023 SW (LOW when pressed)
const int PIN_RFID_SS = 10;   // RC522 SDA/SS  (SCK=13, MOSI=11, MISO=12 on the SPI header)
const int PIN_RFID_RST = 9;   // RC522 RST
const bool JOY_INVERT_Y = false;  // flip if "up" registers as "down" on your module

// ---------- Timing ----------
const unsigned long POLL_MS = 1000;
const unsigned long READING_MS = 10000;
const unsigned long CODE_IDLE_MS = 6000;

MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_BMP280 bmp;
ArduinoLEDMatrix matrix;
bool haveBmp = false;

struct State {
  String level = "NONE";
  long left = 0;
  long window = 1;
  bool acked = false;
  String outlook = "calm";
} st;

String code = "";
unsigned long lastPoll = 0, lastReading = 0, lastCodeInput = 0, lastNfc = 0, okUntil = 0, hintUntil = 0;
bool touchWas = false, swWas = false;
int joyDir = 0;  // 0 neutral, 1 up, 2 right, 3 down, 4 left

// ---------- Matrix icons (8 rows x 12 columns) ----------
const char* ICON_QUESTION[8] = {
  "....####....", "...#....#...", "........#...", ".......#....",
  "......#.....", "......#.....", "............", "......#....."};
const char* ICON_BANG[8] = {
  ".....##.....", ".....##.....", ".....##.....", ".....##.....",
  ".....##.....", "............", ".....##.....", ".....##....."};
const char* ICON_CHECK[8] = {
  "............", "..........#.", ".........#..", "........#...",
  ".#.....#....", "..#...#.....", "...#.#......", "....#......."};
const char* ICON_ARROW[8] = {
  "......#.....", ".......#....", "........#...", "############",
  "############", "........#...", ".......#....", "......#....."};
const char* ICON_KEY[8] = {
  "............", ".###........", "#...#.......", "#...########",
  "#...#..#.#..", ".###...#.#..", "............", "............"};

uint8_t frame[8][12];

void drawIcon(const char* rows[8]) {
  for (int r = 0; r < 8; r++)
    for (int c = 0; c < 12; c++) frame[r][c] = rows[r][c] == '#';
  matrix.renderBitmap(frame, 8, 12);
}

// Armed: a fuse that burns down until the next check-in, plus entered joystick moves on the bottom row.
void drawFuse() {
  memset(frame, 0, sizeof(frame));
  int lit = st.window > 0 ? (int)ceil(12.0 * st.left / st.window) : 0;
  for (int c = 0; c < lit && c < 12; c++) { frame[3][c] = 1; frame[4][c] = 1; }
  for (int i = 0; i < (int)code.length() && i < 12; i++) frame[7][i] = 1;
  matrix.renderBitmap(frame, 8, 12);
}

void drawWaiting() {
  memset(frame, 0, sizeof(frame));
  if ((millis() / 600) % 2) frame[4][6] = 1;
  matrix.renderBitmap(frame, 8, 12);
}

// ---------- HTTP ----------
int http(const char* method, const char* path, const String& body, String& out) {
  WiFiClient client;
  client.setTimeout(1500);
  if (!client.connect(SERVER_HOST, SERVER_PORT)) return -1;
  client.print(method); client.print(' '); client.print(path); client.println(" HTTP/1.1");
  client.print("Host: "); client.println(SERVER_HOST);
  client.print("X-Switch-Key: "); client.println(SWITCH_KEY);
  client.println("Connection: close");
  if (body.length()) {
    client.println("Content-Type: application/json");
    client.print("Content-Length: "); client.println(body.length());
  }
  client.println();
  if (body.length()) client.print(body);

  unsigned long t = millis();
  while (!client.available() && client.connected() && millis() - t < 3000) delay(5);
  String status = client.readStringUntil('\n');  // HTTP/1.1 200 OK
  int codeNum = status.length() > 12 ? status.substring(9, 12).toInt() : -1;
  while (client.connected() || client.available()) {  // skip headers
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
  }
  out = client.readString();
  client.stop();
  return codeNum;
}

int sendEvent(const String& json) {
  String out;
  int status = http("POST", "/api/switch/event", json, out);
  Serial.print("event "); Serial.print(json); Serial.print(" -> "); Serial.print(status); Serial.print(' '); Serial.println(out);
  return status;
}

String field(const String& body, const char* key) {
  String k = String(key) + "=";
  int i = body.indexOf(k);
  if (i < 0) return "";
  int end = body.indexOf(';', i);
  if (end < 0) end = body.indexOf('\n', i);
  if (end < 0) end = body.length();
  return body.substring(i + k.length(), end);
}

void pollState() {
  String out;
  int status = http("GET", "/api/switch/state", "", out);
  if (status != 200) { Serial.print("poll failed: "); Serial.println(status); return; }
  String prev = st.level;
  st.level = field(out, "L");
  st.left = field(out, "S").toInt();
  st.window = max(1L, field(out, "W").toInt());
  st.acked = field(out, "A") == "1";
  st.outlook = field(out, "O");
  bool wasAlarming = prev == "ALARM" || prev == "CONTACT" || prev == "WIDER";
  if (wasAlarming && st.level == "ARMED") celebrate();  // stood down
  if (prev != st.level) { Serial.print("level "); Serial.println(st.level); }
}

// ---------- Feedback ----------
void chirp(int f, int ms) { tone(PIN_BUZZER, f, ms); }
void errorBuzz() { tone(PIN_BUZZER, 220, 400); }
void celebrate() {
  okUntil = millis() + 2500;
  chirp(1318, 90); delay(110); chirp(1568, 90); delay(110); chirp(2093, 140);
}

void driveOutputs() {
  unsigned long t = millis();
  const String& L = st.level;

  // Matrix
  if (t < okUntil) drawIcon(ICON_CHECK);
  else if (t < hintUntil) drawIcon(ICON_KEY);
  else if (L == "ARMED") drawFuse();
  else if (L == "NUDGE") drawIcon(ICON_QUESTION);
  else if (L == "ALARM") { if ((t / 250) % 2) drawIcon(ICON_BANG); else { memset(frame, 0, sizeof(frame)); matrix.renderBitmap(frame, 8, 12); } }
  else if (L == "CONTACT" || L == "WIDER") drawIcon(st.acked ? ICON_ARROW : ICON_BANG);
  else drawWaiting();

  // LED: breathing while armed, faster as the outlook worsens; blinking on nudge/alarm.
  int level = 0;
  if (L == "ARMED") {
    float period = st.outlook == "elevated" ? 500 : st.outlook == "watch" ? 900 : 1800;
    level = 8 + (int)(120 * (0.5 + 0.5 * sin(2 * PI * (t % (unsigned long)period) / period)));
  } else if (L == "NUDGE") level = (t / 300) % 2 ? 255 : 0;
  else if (L == "ALARM") level = (t / 120) % 2 ? 255 : 0;
  else if (L == "CONTACT" || L == "WIDER") level = 255;
  analogWrite(PIN_STATUS_LED, level);

  // Buzzer patterns
  static unsigned long nextBeep = 0;
  if (t >= nextBeep) {
    if (L == "NUDGE") { chirp(1760, 80); nextBeep = t + 2000; }
    else if (L == "ALARM") { static bool hi = false; chirp(hi ? 1046 : 784, 220); hi = !hi; nextBeep = t + 250; }
    else if ((L == "CONTACT" || L == "WIDER") && !st.acked) { chirp(988, 120); nextBeep = t + 6000; }
    else nextBeep = t + 200;
  }
}

// ---------- Inputs ----------
void readTouch() {
  bool touched = digitalRead(PIN_TOUCH) == HIGH;
  if (touched && !touchWas) {
    chirp(2093, 60);
    int status = sendEvent("{\"type\":\"touch\"}");
    if (status == 200) { analogWrite(PIN_STATUS_LED, 255); delay(80); }
    else if (status == 409) { hintUntil = millis() + 2000; chirp(440, 120); delay(160); chirp(440, 120); }  // alarm needs the code
    else errorBuzz();
  }
  touchWas = touched;
}

void readJoystick() {
  int x = analogRead(PIN_JOY_X);
  int y = analogRead(PIN_JOY_Y);
  if (JOY_INVERT_Y) y = 1023 - y;
  int dir = 0;
  if (y < 312) dir = 1;          // up
  else if (x > 712) dir = 2;     // right
  else if (y > 712) dir = 3;     // down
  else if (x < 312) dir = 4;     // left

  if (dir && !joyDir && code.length() < 8) {  // new move, counted once until it returns to centre
    code += String(dir);
    lastCodeInput = millis();
    chirp(1318, 40);
  }
  joyDir = dir;

  bool pressed = digitalRead(PIN_JOY_SW) == LOW;
  if (pressed && !swWas) {
    if (code.length() >= 4) {
      int status = sendEvent("{\"type\":\"code\",\"code\":\"" + code + "\"}");
      if (status == 403) errorBuzz();
      else if (status == 200) { pollState(); if (st.level == "ARMED") celebrate(); }
    } else {
      chirp(330, 150);  // too short: cleared
    }
    code = "";
  }
  swWas = pressed;
  if (code.length() && millis() - lastCodeInput > CODE_IDLE_MS) code = "";
}

void readNfc() {
  if (millis() - lastNfc < 3000) return;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  rfid.PICC_HaltA();
  lastNfc = millis();
  Serial.print("nfc tag "); Serial.println(uid);
  chirp(1568, 60);
  int status = sendEvent("{\"type\":\"nfc\",\"tag\":\"" + uid + "\"}");
  if (status == 200) { st.level = "RESOLVED"; okUntil = millis() + 3000; celebrate(); }
  else errorBuzz();
}

void sendReading() {
  if (!haveBmp) return;
  float tempC = bmp.readTemperature();
  float hpa = bmp.readPressure() / 100.0;
  sendEvent("{\"type\":\"reading\",\"temp_c\":" + String(tempC, 1) + ",\"pressure_hpa\":" + String(hpa, 1) + "}");
}

// ---------- WiFi ----------
void connectWifi() {
  Serial.print("WiFi: connecting to "); Serial.println(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) { drawWaiting(); delay(250); }
  }
  Serial.print("WiFi: connected, IP "); Serial.println(WiFi.localIP());
  chirp(1568, 80);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TOUCH, INPUT);
  pinMode(PIN_JOY_SW, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  matrix.begin();

  SPI.begin();
  rfid.PCD_Init();
  Wire.begin();
  haveBmp = bmp.begin(0x76) || bmp.begin(0x77);
  Serial.println(haveBmp ? "BMP280 ready" : "BMP280 not found (readings off)");

  connectWifi();
  pollState();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  unsigned long t = millis();
  if (t - lastPoll >= POLL_MS) { lastPoll = t; pollState(); }
  if (t - lastReading >= READING_MS) { lastReading = t; sendReading(); }
  readTouch();
  readJoystick();
  readNfc();
  driveOutputs();
  delay(10);
}
