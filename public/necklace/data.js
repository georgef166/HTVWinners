// Copy for the four sensors. Every claim comes from hardware/README.md. Do not add specs that are not there.
export const IDS = ['touch', 'buzzer', 'baro', 'brain'];

export const COMPONENTS = {
  touch: {
    id: 'touch',
    name: 'Touch sensor',
    short: 'Touch',
    tag: 'D4',
    tip: "Tap to check in 'I'm OK'. During an alarm, the phone PIN is needed instead.",
    body: [
      'Tap it to check in ("I’m OK"). During an alarm the phone’s PIN is needed instead.',
      'The optional joystick (USE_JOYSTICK 1) can enter a gesture PIN: up = 1, right = 2, down = 3, left = 4, then press. 1234 cancels the demo alarm.',
    ],
    facts: [
      { k: 'Grove port', v: 'D4' },
      { k: 'Breadboard', v: 'TTP223: SIG / VCC / GND to D4 / 5V / GND' },
      { k: 'Event sent', v: 'touch, a check-in' },
    ],
  },
  buzzer: {
    id: 'buzzer',
    name: 'Buzzer',
    short: 'Buzzer',
    tag: 'D8',
    tip: "Chirps on a nudge, sounds a loud alarm, then beeps every 6 s until your contact says they're on it.",
    body: [
      'Chirps on a nudge, sounds a loud alarm, and beeps every 6 s until your contact says they’re on it.',
      'SILENT 1 mutes it for quiet rooms.',
    ],
    facts: [
      { k: 'Grove port', v: 'D8' },
      { k: 'Breadboard', v: 'Passive buzzer: + / − to D8 / GND' },
      { k: 'Repeat', v: 'Every 6 s after the alarm' },
    ],
  },
  baro: {
    id: 'baro',
    name: 'Barometer / temperature',
    short: 'Barometer',
    tag: 'I2C',
    tip: 'Reads temperature and pressure every 10 s.',
    body: [
      'Reads temperature and pressure every 10 s and feeds the temperature into the prediction engine.',
      'At 5°C or below the server adds a “likely outside in the cold” signal.',
    ],
    facts: [
      { k: 'Part', v: 'DPS310, or a BMP280/BME280' },
      { k: 'Grove port', v: 'Any I2C port' },
      { k: 'Breadboard (BMP280)', v: 'SDA / SCL / 3.3V / GND' },
      { k: 'Serial log', v: 'DPS310 ready: 23.7 C, 1011.1 hPa' },
    ],
  },
  brain: {
    id: 'brain',
    name: 'Arduino Uno R4 WiFi',
    short: 'Arduino',
    tag: 'Brain',
    tip: 'The brain. Talks to the server over WiFi or a USB link and drives the LED matrix.',
    body: [
      'The Switch is built on an Arduino Uno R4 WiFi. It talks to the server over WiFi, or over a USB link when there is no WiFi.',
      'The built-in LED matrix shows a fuse burning down to the next check-in, ? on a nudge, ! on alarm, an arrow once the contact is on the way, and a check when cancelled.',
    ],
    facts: [
      { k: 'WiFi', v: '2.4 GHz networks only' },
      { k: 'USB link', v: 'npm run switch-bridge relays when there is no WiFi' },
      { k: 'Serial Monitor', v: '115200' },
      { k: 'LED matrix', v: '? nudge, ! alarm, arrow on the way, check cancelled' },
    ],
  },
};
