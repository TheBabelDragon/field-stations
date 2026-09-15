# Single-LED RFID Field Station

The LED is intended to be a coherent optical transmitter.
It is a first-class part of the architecture, not a status light.

Backbone: RFID = input, LED = optical output, Field OS = event/state layer.

## 1. RFID: the input channel

A tag event produces an internal observation:

- tag identity
- read confidence
- signal / read characteristics
- timestamp
- station identity
- sequence number

The RFID subsystem does not modify Field OS state.
It produces an observation.

## 2. LED: the optical transmitter

A QR code is a static physical pattern read by a camera.
The station inverts that:

```
data -> optical encoder -> single LED -> camera -> optical decoder -> data
```

One controlled light source. Information in time. A one-pixel QR transmitter.

## 3. Coherent optical protocol

Not arbitrary Morse.

```
SYNC | VERSION | STATION_ID | SEQUENCE | MESSAGE_TYPE
     | PAYLOAD_LENGTH | PAYLOAD | CHECKSUM | ECC
```

The decoder must find the signal if the camera starts halfway through.
A corrupted frame is a rejected observation, never a different message.

Assumed damage: ambient light, reflections, motion blur, exposure,
rolling shutter, partial observation, distance, LED saturation.

## 4. Camera-native transmission

v0 modulation is binary OOK with a robust timing protocol.
Logical symbols stay separate from physical modulation so the
encoding scheme can evolve without changing the application packet.

## 5. RFID -> Field OS -> optical broadcast

```
RFID TAG -> Observation -> Admission / Validation -> FieldDelta -> FieldTick
        -> canonical field state
        -> Optical Encoder -> SINGLE LED -> Camera -> Decoded Field Packet
```

The station observes an object and immediately broadcasts a
machine-readable representation of the resulting field event
into physical space.

## 6. LED state vs optical data

Semantic states: IDLE, DISCOVERING, OBSERVING, ENCODING, TRANSMITTING, ERROR.

During transmission the protocol owns the pin.

## 7. Field OS boundary

```
Field Station -> FieldObservation -> Field OS -> FieldTick -> consumers
```

RFID -> Field OS without the LED.
Field OS -> LED without RFID.

## 8. Canonsphere

Downstream only. Useful test: did the event survive the complete physical loop?

```
FIELD EVENT -> RFID -> FIELD OS -> LED -> CAMERA -> DECODER -> FIELD OS -> REPLAY
```

Matching state hashes means the physical transmission reproduced
the canonical event.

## 9. First milestone

A single LED reliably transmits a structured Field OS event to an
ordinary camera. RFID is simply the first sensor on that terminal.
