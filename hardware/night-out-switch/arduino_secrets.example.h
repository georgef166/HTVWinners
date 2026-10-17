// Copy this file to arduino_secrets.h (gitignored) and fill it in.
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASS "your-wifi-password"
// The laptop running `npm start`, on the same WiFi. Find it with: ipconfig getifaddr en0
#define SERVER_HOST "192.168.1.50"
#define SERVER_PORT 3000
// Must match SWITCH_KEY in the server's .env ("demo-switch" when DEMO is on and SWITCH_KEY is unset)
#define SWITCH_KEY "demo-switch"
