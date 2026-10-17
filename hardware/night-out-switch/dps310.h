// Minimal driver for the Infineon DPS310 (Grove High Precision Barometer, I2C 0x77 or 0x76).
// Written here because some boards report product ID 0x11, which the Adafruit library rejects.
// Follows the DPS310 datasheet: read calibration coefficients once, measure continuously at 8x
// oversampling, compensate temperature and pressure in software.
#pragma once
#include <Wire.h>

class DPS310 {
 public:
  bool begin(uint8_t addr) {
    _a = addr;
    uint8_t id;
    if (!read(0x0D, &id, 1) || (id & 0xF0) != 0x10) return false;  // REV_ID 1, any PROD_ID
    write(0x0C, 0x09);  // soft reset
    delay(40);
    for (int i = 0; i < 50; i++) {  // wait for COEF_RDY and SENSOR_RDY
      uint8_t m; read(0x08, &m, 1);
      if ((m & 0xC0) == 0xC0) break;
      delay(10);
    }
    // Work around the chip's temperature bug after reset (from Infineon's reference driver).
    write(0x0E, 0xA5); write(0x0F, 0x96); write(0x62, 0x02); write(0x0E, 0x00); write(0x0F, 0x00);
    if (!readCoefficients()) return false;
    uint8_t src; read(0x28, &src, 1);
    uint8_t ext = src & 0x80;          // use the temperature sensor the coefficients were made with
    write(0x06, 0x23);                 // pressure: 4 measurements/s, 8x oversampling
    write(0x07, ext | 0x23);           // temperature: same
    write(0x09, 0x00);                 // no result shift needed at 8x
    write(0x08, 0x07);                 // continuous pressure + temperature
    delay(300);
    return true;
  }

  // Temperature in °C and pressure in hPa. Returns false if the bus read fails.
  bool readBoth(float& tempC, float& hpa) {
    uint8_t b[6];
    if (!read(0x00, b, 6)) return false;
    const float k = 7864320.0f;        // scale factor for 8x oversampling
    float p = raw24(b) / k, t = raw24(b + 3) / k;
    tempC = _c0 * 0.5f + _c1 * t;
    float pa = _c00 + p * (_c10 + p * (_c20 + p * _c30)) + t * _c01 + t * p * (_c11 + p * _c21);
    hpa = pa / 100.0f;
    return true;
  }

 private:
  uint8_t _a = 0x77;
  float _c0, _c1, _c00, _c10, _c01, _c11, _c20, _c21, _c30;

  static int32_t sext(uint32_t v, int bits) { return (v & (1UL << (bits - 1))) ? (int32_t)(v - (1UL << bits)) : (int32_t)v; }
  static int32_t raw24(const uint8_t* b) { return sext(((uint32_t)b[0] << 16) | ((uint32_t)b[1] << 8) | b[2], 24); }

  bool readCoefficients() {
    uint8_t c[18];
    if (!read(0x10, c, 18)) return false;
    _c0 = sext(((uint32_t)c[0] << 4) | (c[1] >> 4), 12);
    _c1 = sext(((uint32_t)(c[1] & 0x0F) << 8) | c[2], 12);
    _c00 = sext(((uint32_t)c[3] << 12) | ((uint32_t)c[4] << 4) | (c[5] >> 4), 20);
    _c10 = sext(((uint32_t)(c[5] & 0x0F) << 16) | ((uint32_t)c[6] << 8) | c[7], 20);
    _c01 = sext(((uint32_t)c[8] << 8) | c[9], 16);
    _c11 = sext(((uint32_t)c[10] << 8) | c[11], 16);
    _c20 = sext(((uint32_t)c[12] << 8) | c[13], 16);
    _c21 = sext(((uint32_t)c[14] << 8) | c[15], 16);
    _c30 = sext(((uint32_t)c[16] << 8) | c[17], 16);
    return true;
  }

  bool read(uint8_t reg, uint8_t* buf, uint8_t n) {
    Wire.beginTransmission(_a); Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(_a, n) != n) return false;
    for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
    return true;
  }
  void write(uint8_t reg, uint8_t v) { Wire.beginTransmission(_a); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }
};
