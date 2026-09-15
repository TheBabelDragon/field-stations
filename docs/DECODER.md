# QR bootstrap + GitHub Pages decoder

The printed QR is discovery.
The LED is the live optical channel.

## Target

Pages is publishing the repository root, so the live site is the `pages/` folder:

```
https://thebabeldragon.github.io/field-stations/
        -> redirects to /pages/

https://thebabeldragon.github.io/field-stations/pages/
https://thebabeldragon.github.io/field-stations/pages/decode.html?station=7F29&v=1&sym=80
```

Print the decode URL as an ordinary QR. Put the LED inside or immediately next to the code.
The URL stays still while station state changes.

Query fields:

| key | meaning |
| --- | --- |
| `station` | 16-bit station id, hex |
| `v` | protocol version |
| `sym` | symbol period in milliseconds |
| `led` | `center` or `bright` |
| `demo=1` | virtual LED, no camera |

## Why /pages/

GitHub Pages from branch `main` serves the repo root.
The decoder lives in `pages/` so it does not collide with firmware, contracts, or tests.
`index.html` at the repo root redirects `/` into `/pages/`.

## Hardware stays dumb

ESP32: read RFID, encode frame, blink one LED, repeat the frame.
