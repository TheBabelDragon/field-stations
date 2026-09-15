# QR bootstrap + GitHub Pages decoder

The printed QR is discovery.
The LED is the live optical channel.

## Target

GitHub Actions publishes the `pages/` folder as the site root.
There is no extra `/pages/` in the public URL.

- site: https://thebabeldragon.github.io/field-stations/
- decoder: https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=80
- virtual LED: https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=80&demo=1

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

## Hardware stays dumb

ESP32: read RFID, encode frame, blink one LED, repeat the frame.
