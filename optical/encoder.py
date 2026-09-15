"""Logical frame -> symbol stream.

The application never drives the LED while TRANSMITTING.
"""

from __future__ import annotations

from .protocol import (
    LEAD_IN,
    MAX_PAYLOAD,
    PREAMBLE,
    PROTOCOL_VERSION,
    OpticalFrame,
    StationObservation,
    bytes_to_bits,
    crc16_ccitt,
    ecc_encode,
    manchester_encode,
    pack_header,
    station_id_numeric,
)


def encode_frame(frame: OpticalFrame) -> list[int]:
    if len(frame.payload) > MAX_PAYLOAD:
        raise ValueError("payload-too-large")
    header = pack_header(
        frame.version,
        frame.station_id,
        frame.sequence,
        frame.message_type,
        len(frame.payload),
    )
    body = header + frame.payload
    crc = crc16_ccitt(body)
    protected = body + crc.to_bytes(2, "big")
    ecc = ecc_encode(protected)
    bits = bytes_to_bits(bytes([len(ecc)]) + ecc)
    return list(LEAD_IN) + list(PREAMBLE) + manchester_encode(bits)


def encode_observation(obs: StationObservation, station_numeric: int | None = None) -> tuple[OpticalFrame, list[int]]:
    from .protocol import MESSAGE_FIELD_OBSERVATION

    sid = station_numeric if station_numeric is not None else station_id_numeric(obs.station_id)
    frame = OpticalFrame(
        version=PROTOCOL_VERSION,
        station_id=sid,
        sequence=obs.sequence & 0xFFFF,
        message_type=MESSAGE_FIELD_OBSERVATION,
        payload=obs.payload_bytes(),
    )
    return frame, encode_frame(frame)
