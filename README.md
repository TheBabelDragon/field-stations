# field-stations

**v0.1 — single-LED RFID Field Station.**

RFID is the input channel.
The LED (or the browser disc standing in for one) is the physical broadcast channel.
Field OS is the event/state layer.
GitHub Pages is the optical receiver.
Canonsphere is an optional witness / replay client.

## Target

- site: [thebabeldragon.github.io/field-stations](https://thebabeldragon.github.io/field-stations/)
- transmitter: [tx.html?station=7F29&sym=67&stage=1&period=120](https://thebabeldragon.github.io/field-stations/tx.html?station=7F29&sym=67&stage=1&period=120)
- decoder: [decode.html?station=7F29&stage=1&period=120](https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&stage=1&period=120)

## Live loop

1. Computer: transmitter, tap fullscreen. Bright disc on black.
2. Phone: decoder → **CAMERA** → tap the disc.
3. Tap is a persistent **LOCKED** ROI. **UNLOCK** returns to AUTO.
4. Success is **RECEIVED XX** — the byte measured from light, not copied from the URL.

```
computer / browser
    ↓ light
phone camera
    ↓ measured waveform
CLOCK_TRAIN → recovered symbol clock
    ↓
SYNC
    ↓
independently decoded payload
    ↓
CRC (stage 3+)
    ↓
RECEIVED
```

## Physical protocol

```
CLOCK  10101010 10101010
SYNC   11001100
DATA   stage-dependent payload
```

Stage 1: payload byte.
Stage 2: station + payload.
Stage 3: station + seq + payload + CRC.

Clock comes from the alternating train. SYNC starts the frame.
`samples[0]` is not a frame boundary. `sym=` is not an oracle.

```
CAMERA
  ↓
temporal candidate acquisition
  ↓
persistent ROI
  ↓
CLOCK_TRAIN
  ↓
recovered symbol clock
  ↓
SYNC
  ↓
payload / frame
  ↓
CRC validation
  ↓
recovered FieldObservation
```

Details: [docs/DECODER.md](docs/DECODER.md).

## Backbone

```
RFID = input
LED  = optical output
Field OS = event / state layer
Pages decoder = camera receiver
```

See [`field-os`](https://github.com/TheBabelDragon/field-os)
and [`canonsphere`](https://github.com/TheBabelDragon/canonsphere).

## Tests

```bash
python3 -m unittest discover -s tests -v
node tests/test_js_codec.mjs
node tests/test_phy.mjs
```

## Layout

```
contracts/          FieldObservation + OpticalFrame schemas
firmware/           ESP32 RFID + single-LED station stubs
optical/            Python protocol / encoder / decoder
pages/              GitHub Pages transmitter + camera receiver
simulator/          virtual station loop
host/               encode / decode tools
tests/              protocol, optical channel, JS PHY
```

## Non-goals

- Do not treat the LED as an indicator that happens to blink.
- Do not put the live payload in the QR.
- Do not use the URL payload as decoder ground truth.
- Do not let AUTO wander after a candidate is acquired.
- Do not expire a manual lock on a timer.
- Do not decode a frame from `samples[0]`.
- Do not send camera frames to a server.

## License

MIT. See [LICENSE](LICENSE).
