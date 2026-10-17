# The hardware Switch

A clip-on Switch built on an **Arduino Uno R4 WiFi**. Maya can check in, cancel an alarm and end the night without touching her phone. It also feeds a temperature reading into the prediction engine.

| Part | What it does |
|---|---|
| Touch sensor | Check in ("I'm OK"). During an alarm the phone's PIN is needed instead |
| LED | Breathes while armed (faster as the outlook worsens), blinks on a nudge, fast on alarm, solid once the contact is alerted |
| Buzzer | Chirp on a nudge, loud alarm, and a beep every 6 s until the contact says they're on it. `SILENT 1` mutes it for quiet rooms |
| Barometer (DPS310, or a BMP280/BME280) | Temperature and pressure every 10 s. At 5°C or below the server adds a "likely outside in the cold" signal |
| Built-in LED matrix | A fuse that burns down to the next check-in, `?` on a nudge, `!` on alarm, an arrow once the contact is on the way, a check when cancelled |
| Joystick (optional, `USE_JOYSTICK 1`) | Gesture PIN: up = 1, right = 2, down = 3, left = 4, then press. 1234 cancels the demo alarm |
| Grove NFC Tag (M24LR64E), any I2C port | Holds the current night's link (Maya's page), rewritten whenever a new night starts, so tapping a phone on the Switch opens it. Needs the module's coil antenna plugged in; without it phones can't read the tag. iPhones may need an NFC reader app for this tag type, while Android reads it natively |
| NFC reader (optional) | Tap the home tag to end the night. Needs a reader: a Grove NFC (PN532) or an RC522 (`NFC_RC522 1`). A Grove **NFC Tag** (M24LR64E) is a tag, not a reader, so it can't do this |

## Wiring: Grove Base Shield (what we built with)

Plug each module into the shield port with the same name as the pin in the sketch, and set the shield's power switch to 5V.

| Module | Shield port |
|---|---|
| Touch sensor | D4 |
| LED | D6 |
| Buzzer | D8 |
| Grove High Precision Barometer (DPS310) | any I2C port |
| Grove NFC reader (PN532), if you have one | UART |
| Grove thumb joystick, if used | A0 |

On boot the Serial Monitor (115200) shows what it found: the I2C devices, `DPS310 ready: 23.7 C, 1011.1 hPa`, and whether an NFC reader answered.

## Wiring: loose parts on a breadboard

| Part | Module pin | Uno R4 WiFi pin |
|---|---|---|
| Touch (TTP223) | SIG / VCC / GND | D4 / 5V / GND |
| LED | anode → 220 Ω → | D6 (cathode to GND) |
| Buzzer (passive) | + / − | D8 / GND |
| Joystick (KY-023) | VRx / VRy / SW / +5V / GND | A0 / A1 / D2 / 5V / GND |
| NFC (RC522) | SDA(SS) / SCK / MOSI / MISO / RST / 3.3V / GND | D10 / D13 / D11 / D12 / D9 / **3.3V** / GND |
| Barometer (BMP280) | SDA / SCL / VCC / GND | SDA / SCL / **3.3V** / GND |

The RC522 and BMP280 are 3.3 V parts, so power them from the 3.3V pin.

## Flash it

1. In the Arduino IDE, install the **Arduino UNO R4 Boards** core (Boards Manager), then the **MFRC522**, **Adafruit BMP280 Library** and **Adafruit PN532** libraries (Library Manager; accept the dependencies). The DPS310 driver is included in the sketch.
2. Copy `night-out-switch/arduino_secrets.example.h` to `night-out-switch/arduino_secrets.h` and fill in:
   - your WiFi name and password (the laptop and board must be on the same network; a phone hotspot works well at hackathons)
   - `SERVER_HOST` and `SERVER_PORT`: the live server (`155-138-145-175.sslip.io`, port `80`; the server allows plain HTTP for `/api/switch/*` only), or the laptop's IP and port when running locally
   - `SWITCH_KEY`: matches `SWITCH_KEY` in the server's `.env` (on Vultr: `node deploy/vultr.mjs ssh`, then look in the app's `.env`). With `DEMO` on and no key set, it's `demo-switch`
   - Leave the WiFi name as `your-wifi-name` to use the USB link instead (below)
3. Open `night-out-switch/night-out-switch.ino`, pick **Arduino UNO R4 WiFi**, and upload. Open Serial Monitor at 115200 to watch it connect.

From the command line, with the IDE's bundled CLI:

```bash
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi hardware/night-out-switch
```

If the board connects but can't reach the server, macOS may be blocking incoming connections to `node`. Allow it in System Settings → Network → Firewall.

## No WiFi? Use the USB link

The board only joins 2.4 GHz networks, and venue WiFi with a login page won't work. With no WiFi set, the firmware sends its requests over the USB cable instead, and a small script on the laptop relays them to the server:

```bash
npm run switch-bridge
```

It reads the server and key from `arduino_secrets.h` (or `SWITCH_URL` / `SWITCH_KEY`), finds the board on `/dev/cu.usbmodem*` (or `SWITCH_PORT`), and prints the board's log, every event it sends, and the night's level as it changes.

## How it talks to the server

The Switch controls the **night it's linked to** (one Switch per server). The live stage links it automatically when you start a night; on the links page, use **Use the Switch for this night**. Other people starting nights on their own phones can't take it over. Every request carries `X-Switch-Key`.

- `GET /api/switch/state` returns plain text, so the board doesn't need a JSON parser:
  `L=ARMED;S=12;W=15;A=0;O=calm;C=Jordan` (level, seconds left, window, contact acked, outlook, contact name)
- `POST /api/switch/event` with JSON:
  - `{"type":"touch"}` → check-in (409 `ERR;NEEDCODE` during an alarm)
  - `{"type":"code","code":"1234"}` → stand down (403 `ERR;WRONGCODE` if wrong)
  - `{"type":"nfc","tag":"04A1B2C3"}` → ends the night if the tag is in `SWITCH_HOME_TAG` (in demo mode with none set, any tag)
  - `{"type":"reading","temp_c":21.5,"pressure_hpa":1013.2}` → sensor reading for prediction

## No board? Use the simulator

```bash
npm run switch-sim
```

Keys: `t` touch, arrows or `w a s d` for the joystick, `enter` to send the code, `n` taps the NFC home tag, `c` toggles a freezing reading. Point it at another server with `SWITCH_URL=http://host:port`.
