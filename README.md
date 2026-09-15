# field-stations

**v0.1 — single-LED RFID Field Station.**

RFID is the input channel.
The LED is the physical broadcast channel.
Field OS is the event/state layer.
Canonsphere is an optional witness / replay client.

This is not an RFID reader with a status light.
It is a physical Field OS terminal with a bidirectional sensing/broadcast boundary.

```
                 PHYSICAL OBJECT
                       |
                       v
                  RFID / NFC
                       | identity
                       v
              +-----------------+
              | FIELD STATION   |
              | observation     |
              | state           |
              | optical encoder |
              +--------+--------+
                       | coherent optical packet
                       v
                 SINGLE LED
                       |
                       v
                   CAMERA
                       |
                       v
               optical decoder
```

The LED is a one-pixel QR transmitter: information lives in time, not in printed modules.

## Backbone

```
RFID = input
LED  = optical output
Field OS = event / state layer
```

Each subsystem is independently useful:

- `RFID -> Field OS` without the LED
- `Field OS -> LED` without RFID

The station must not reinvent Field OS.
It emits `FieldObservation`. Field OS admits it. Consumers see `FieldTick`.
The optical transmitter is another interface onto that canonical information.

See [`field-os`](https://github.com/TheBabelDragon/field-os)
and [`canonsphere`](https://github.com/TheBabelDragon/canonsphere).

## First milestone

```
RFID TAG -> ESP32 -> FieldObservation -> Field OS
        -> optical encoder -> ONE LED
        -> phone camera -> decoder -> original packet
```

Success: a single LED reliably transmits a structured Field OS event
to an ordinary camera.

The RFID hardware is only the first sensor feeding the system.

Host-side proof (no hardware required):

```bash
python3 -m unittest discover -s tests -v
python3 -m simulator.virtual_station
python3 -m host.station_tools encode --tag deadbeefcafe0001
```

## Optical protocol (v0)

Not Morse. A framed physical-layer packet.

```
SYNC | VERSION | STATION_ID | SEQUENCE | TYPE | LEN | PAYLOAD | CRC16 | ECC
```

- **SYNC** is a raw preamble a camera can lock onto mid-recording.
- Everything after SYNC is **Manchester-coded** so symbol timing can be recovered
  from rolling shutter, exposure, and motion.
- **CRC-16-CCITT** rejects silent corruption.
- **Hamming(8,4)** on the payload is forward error correction.
- A damaged frame becomes a **rejected observation**, never a different message.

Logical symbols are separate from physical modulation.
v0 modulation is binary OOK (`LED ON` / `LED OFF`).
Later: intensity, color, rolling-shutter density.

The LED semantic state (`IDLE`, `DISCOVERING`, `OBSERVING`, `ENCODING`,
`TRANSMITTING`, `ERROR`) is distinct from the transmit waveform.
While a packet is on the air, the protocol owns the pin.

## Closed physical loop

```
FIELD EVENT -> RFID -> FIELD OS -> LED -> CAMERA -> DECODER -> FIELD OS -> REPLAY
```

If the reconstructed state hash matches, the physical transmission
reproduced the canonical event.

Canonsphere stays downstream. It visualizes the loop; it does not own it.

## Layout

```
contracts/          admitted FieldObservation + OpticalFrame schemas
firmware/           ESP32 RFID + single-LED station (boundary stubs)
optical/            protocol, encoder, decoder, camera-channel simulator
simulator/          virtual station: RFID -> Field OS-shaped tick -> LED -> camera
host/               encode / decode / inspect tools
tests/              protocol, optical channel, replay hash
```

## Non-goals

- Do not treat the LED as an indicator that happens to blink.
- Do not let application code change LED timing during a packet.
- Do not silently accept a corrupted optical frame.
- Do not put Canonsphere or Field OS *inside* this repo.
- Do not hide analog / camera damage behind `LINK_UP`.

## License

MIT. See [LICENSE](LICENSE).
