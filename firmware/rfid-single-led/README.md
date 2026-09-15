# firmware / rfid-single-led

ESP32 Field Station: RFID input, one LED as coherent optical transmitter.

This directory is the *boundary*. It does not contain Field OS.
It produces observations and consumes FieldTick-shaped packets for broadcast.

```
RFID TAG
   |
   v
ESP32
   | FieldObservation
   v
Field OS   (host, or a thin on-device admission shim)
   | FieldTick
   v
optical encoder
   |
   v
ONE LED
```

## Ownership of the LED

| mode | who owns the pin |
| --- | --- |
| idle / discovering / observing / error | station state machine |
| encoding / transmitting | `optical_tx` |

Application code must not toggle the LED during a packet.

## Layout

```
rfid/          tag read -> observation fields
optical_tx/    frame -> Manchester -> OOK timings
led_driver/    pin + idle patterns
station/       state machine, sequence, station id
```

v0 timings assume a phone camera at ~30 fps: keep the symbol period
long enough that a frame sees a stable ON or OFF. Start at 80-100 ms
per symbol. Faster clocks are a later modulation profile.

## Hardware (first board)

- ESP32 / ESP32-S3 / ESP32-C3
- PN532 or RC522 (NFC/RFID)
- one high-contrast LED, isolated from status RGB if the board has one
- ordinary phone camera as the first receiver

PlatformIO env is a stub until the board is wired.
The host Python codec is the source of truth for the frame.
