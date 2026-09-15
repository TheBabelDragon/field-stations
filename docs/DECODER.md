# QR bootstrap + GitHub Pages decoder

The printed QR is discovery.
The LED is the live optical channel.
The phone already knows how to scan a QR.
It does not need to know the optical protocol at that layer.

```
QR "START HERE"
        |
        v
GitHub Pages decoder
        |
        v
"I know this station"
        |
        v
single LED
        |
        v
"HERE IS THE LIVE DATA"
        |
        v
optical decoder
        |
        v
Field OS
```

## Bootstrap URL

```
https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=80
```

Stable while station state changes. Print it as an ordinary QR.
Put the LED inside or immediately next to the code.

Query fields:

| key | meaning |
| --- | --- |
| `station` | 16-bit station id, hex |
| `v` | protocol version |
| `sym` | symbol period in milliseconds |
| `led` | `center` or `bright` |
| `demo=1` | virtual LED, no camera |

## Pages layout

```
pages/
  index.html          bootstrap explanation
  decode.html         camera / virtual receiver
  optical/            sync, sampler, demodulator, frame, ecc
  protocol/           FieldObservation unpack
  station/            QR query -> config
```

No backend. Camera frames never leave the phone.

## Hardware stays dumb

ESP32: read RFID, encode frame, blink one LED, repeat the frame.
The repeating frame is what makes a moving phone able to lock.

## Phases

1. Fake station / virtual LED on Pages
2. Real RFID payload
3. Field OS admission
4. QR geometry as spatial frame
5. Canonsphere witness
