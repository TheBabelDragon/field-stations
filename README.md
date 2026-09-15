# field-stations

**v0.1 — single-LED RFID Field Station.**

RFID is the input channel.
The LED is the physical broadcast channel.
Field OS is the event/state layer.
GitHub Pages is the optical receiver.
Canonsphere is an optional witness / replay client.

## Target

- site: [thebabeldragon.github.io/field-stations](https://thebabeldragon.github.io/field-stations/)
- transmitter: [tx.html?station=7F29&sym=150](https://thebabeldragon.github.io/field-stations/tx.html?station=7F29&v=1&sym=150&phy=demo)
- decoder: [decode.html?station=7F29&sym=150](https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=150)
- self test: [decode.html?demo=1](https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=150&demo=1)

## Live loop (computer + phone)

VIRTUAL LED on the decoder page is a same-tab self test. It does not go through the camera.

For a real demonstration:

1. Computer: open the [transmitter](https://thebabeldragon.github.io/field-stations/tx.html?station=7F29&v=1&sym=150&phy=demo). Fullscreen. Bright disc on black.
2. Phone: open the [decoder](https://thebabeldragon.github.io/field-stations/decode.html?station=7F29&v=1&sym=150).
3. Tap **CAMERA**. Allow the camera. Point at the disc.
4. Tap the disc in the viewfinder so the reticle sits on it.
5. Contrast bar should move. Then `SYNC ✓`. Then a green **LOOP CLOSED** banner and a beep.

Same `station` and same `sym` on both sides. Dim the room. Fill the phone reticle with the disc, not the chrome.

Print the decoder URL as an ordinary QR. Put a hardware LED inside or next to the code later.

This is not an RFID reader with a status light.
It is a physical Field OS terminal with a bidirectional sensing/broadcast boundary.

```
QR  = bootstrap ("start here")
LED = live optical data channel
```

```
PHYSICAL OBJECT -> RFID -> FIELD STATION -> SINGLE LED
                                              |
                                         PHONE CAMERA
                                              |
                                      ordinary QR scan
                                              |
                                         GITHUB PAGES
                                              |
                                       optical decoder
                                              |
                                          FIELD OS
```

## Backbone

```
RFID = input
LED  = optical output
Field OS = event / state layer
Pages decoder = camera receiver
```

Each subsystem is independently useful:

- `RFID -> Field OS` without the LED
- `Field OS -> LED` without RFID
- Pages decoder without RFID (phase 1 virtual LED)

See [`field-os`](https://github.com/TheBabelDragon/field-os)
and [`canonsphere`](https://github.com/TheBabelDragon/canonsphere).

## Decoder

Client-side only. Camera frames never leave the phone.
Details: [docs/DECODER.md](docs/DECODER.md).

## First milestone

```
RFID TAG -> ESP32 -> FieldObservation -> Field OS
        -> optical encoder -> ONE LED
        -> phone camera -> Pages decoder -> original packet
```

Host-side proof (no hardware required):

```bash
python3 -m unittest discover -s tests -v
python3 -m simulator.virtual_station
node tests/test_js_codec.mjs
python3 -m host.station_tools encode --tag deadbeefcafe0001
```

## Optical protocol (v0)

Not Morse. A framed physical-layer packet.

```
SYNC | VERSION | STATION_ID | SEQUENCE | TYPE | LEN | PAYLOAD | CRC16 | ECC
```

Screen-to-phone demos use a short `demo` PHY (same header + CRC, no ECC / Manchester) so a packet finishes in seconds. Hardware later uses v0.

The station repeats the frame so a moving phone can lock mid-stream.
A damaged frame becomes a rejected observation, never a different message.

## Closed physical loop

```
FIELD EVENT -> RFID -> FIELD OS -> LED -> CAMERA -> PAGES DECODER -> FIELD OS -> REPLAY
```

Canonsphere stays downstream. It does not implement the optical protocol.

## Layout

```
contracts/          admitted FieldObservation + OpticalFrame schemas
firmware/           ESP32 RFID + single-LED station (boundary stubs)
optical/            Python protocol, encoder, decoder, camera simulator
pages/              GitHub Pages QR bootstrap + JS optical receiver
simulator/          virtual station loop
host/               encode / decode / inspect tools
tests/              protocol, optical channel, replay hash, JS codec
```

## Non-goals

- Do not treat the LED as an indicator that happens to blink.
- Do not put the live payload in the QR.
- Do not let application code change LED timing during a packet.
- Do not silently accept a corrupted optical frame.
- Do not put Canonsphere or Field OS *inside* this repo.
- Do not hide analog / camera damage behind `LINK_UP`.
- Do not send camera frames to a server.

## License

MIT. See [LICENSE](LICENSE).
