# QR bootstrap + GitHub Pages decoder

The printed QR is discovery.
The LED / display disc is the live optical channel.
An ordinary phone camera reconstructs the bits.

## Target

GitHub Actions publishes the `pages/` folder as the site root.

- site: https://thebabeldragon.github.io/field-stations/
- transmitter: https://thebabeldragon.github.io/field-stations/tx.html?station=7F29&sym=67&stage=1&period=120
- decoder: https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&stage=1&period=120

`sym` is the payload byte the transmitter will emit.
`period` is optional TX bit time. Reception recovers timing from CLOCK_TRAIN.
The decoder does not treat `sym` as the answer.

## Physical loop

```
CAMERA
  ↓
temporal candidate acquisition
  ↓
persistent ROI  (AUTO hold / LOCKED tap)
  ↓
CLOCK_TRAIN  10101010 10101010
  ↓
recovered symbol clock
  ↓
SYNC  11001100
  ↓
payload / frame
  ↓
CRC validation (stage 3+)
  ↓
recovered FieldObservation
```

Tap locks the ROI until UNLOCK. AUTO hunts a blinking disc, then holds it.

## Stages

1. CLOCK + SYNC + PAYLOAD
2. CLOCK + SYNC + STATION + PAYLOAD
3. CLOCK + SYNC + STATION + SEQ + PAYLOAD + CRC8
