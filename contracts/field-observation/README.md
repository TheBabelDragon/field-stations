# FieldObservation (station contract)

This repo does not own Field OS.
The station produces an observation. Field OS admits it.

A tag event becomes an observation, not a state write.

Required sense:

| field | meaning |
| --- | --- |
| `tag.identity` | stable tag UID (opaque string / hex) |
| `tag.confidence` | `[0, 1]` read confidence |
| `tag.rssi` | optional raw / quantized read strength |
| `station.id` | emitting station |
| `station.sequence` | monotonic station sequence |
| `timestamp_ns` | station clock |
| `provenance.class` | `physical` for a live RFID read |

RFID never mutates Field OS state directly.
Admission and validation live in
[`field-os`](https://github.com/TheBabelDragon/field-os).

Schema: [schema.json](schema.json).
The JSON Schema is a *station* envelope. It can be reduced to one or more
`field-os` `Observation` records (`tag.identity` is carried as a hashed
numeric channel plus a side payload on the optical frame).
