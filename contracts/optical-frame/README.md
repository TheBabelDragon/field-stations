# OpticalFrame (v0)

A single LED is a coherent machine-readable transmitter.

```
data -> optical encoder -> single LED -> camera -> optical decoder -> data
```

## Physical assumptions

The decoder must extract the signal from:

- ordinary frame sequences
- exposure variation
- rolling shutter
- motion
- ambient illumination

v0 modulation is binary OOK. Intensity / color / shutter-density
schemes plug in later because **logical symbols != physical modulation**.

## Frame

```
SYNC | STATION | FRAME | PAYLOAD | ECC
preamble | identity | metadata | Field data | parity
```

Wire fields after SYNC:

```
VERSION
STATION_ID
SEQUENCE
MESSAGE_TYPE
PAYLOAD_LENGTH
PAYLOAD
CRC16
ECC
```

A failed CRC or unrecoverable ECC is a rejected observation.
It must not become a different message.

Constants live in `optical/protocol.py`.
