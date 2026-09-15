"""Logical optical packet + RFID observation envelope.

Physical modulation is elsewhere. This module owns the admitted frame.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

PROTOCOL_VERSION = 1

# Raw (non-Manchester) preamble. Chosen so it cannot appear as a
# Manchester run of zeros or ones: Manchester never produces four
# consecutive identical symbols.
PREAMBLE = (1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0)
LEAD_IN = (0, 0, 0, 0, 0, 0, 0, 0)

MESSAGE_STATION_HELLO = 0x00
MESSAGE_FIELD_OBSERVATION = 0x01
MESSAGE_FIELD_TICK = 0x02
MESSAGE_STATE_HASH = 0x03
MESSAGE_REJECTED = 0x04

MAX_PAYLOAD = 64

LED_IDLE = "IDLE"
LED_DISCOVERING = "DISCOVERING"
LED_OBSERVING = "OBSERVING"
LED_ENCODING = "ENCODING"
LED_TRANSMITTING = "TRANSMITTING"
LED_ERROR = "ERROR"

# Idle-state blink patterns. None of these contain PREAMBLE.
STATE_PATTERNS = {
    LED_IDLE: (1, 0, 0, 0, 0, 0, 0, 0),
    LED_DISCOVERING: (1, 0, 1, 0, 0, 0, 0, 0),
    LED_OBSERVING: (1, 1, 0, 0, 0, 0, 0, 0),
    LED_ENCODING: (1, 1, 1, 0, 0, 0, 0, 0),
    LED_ERROR: (1, 0, 1, 0, 1, 0, 1, 0),
}


def crc16_ccitt(data: bytes, seed: int = 0xFFFF) -> int:
    crc = seed
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def nibble_hamming(nibble: int) -> int:
    """Hamming(8,4): data d3 d2 d1 d0 -> p1 p2 d3 p4 d2 d1 d0 p8."""
    d = nibble & 0x0F
    d3, d2, d1, d0 = (d >> 3) & 1, (d >> 2) & 1, (d >> 1) & 1, d & 1
    p1 = d3 ^ d2 ^ d0
    p2 = d3 ^ d1 ^ d0
    p4 = d2 ^ d1 ^ d0
    p8 = p1 ^ p2 ^ d3 ^ p4 ^ d2 ^ d1 ^ d0
    return (p1 << 7) | (p2 << 6) | (d3 << 5) | (p4 << 4) | (d2 << 3) | (d1 << 2) | (d0 << 1) | p8


def nibble_unhamming(code: int) -> tuple[int, bool]:
    """Return (nibble, recovered). recovered True if a single-bit error was fixed."""
    bits = [(code >> i) & 1 for i in range(7, -1, -1)]
    p1, p2, d3, p4, d2, d1, d0, p8 = bits
    s1 = p1 ^ d3 ^ d2 ^ d0
    s2 = p2 ^ d3 ^ d1 ^ d0
    s4 = p4 ^ d2 ^ d1 ^ d0
    s8 = p1 ^ p2 ^ d3 ^ p4 ^ d2 ^ d1 ^ d0 ^ p8
    syndrome = s1 | (s2 << 1) | (s4 << 2)
    recovered = False
    if s8 == 0 and syndrome == 0:
        pass
    elif s8 == 1 and 1 <= syndrome <= 7:
        pos = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6}[syndrome]
        bits[pos] ^= 1
        p1, p2, d3, p4, d2, d1, d0, p8 = bits
        recovered = True
    elif s8 == 1 and syndrome == 0:
        recovered = True
    else:
        raise ValueError("ecc-uncorrectable")
    return ((d3 << 3) | (d2 << 2) | (d1 << 1) | d0), recovered


def ecc_encode(payload: bytes) -> bytes:
    out = bytearray()
    for byte in payload:
        out.append(nibble_hamming((byte >> 4) & 0x0F))
        out.append(nibble_hamming(byte & 0x0F))
    return bytes(out)


def ecc_decode(block: bytes) -> tuple[bytes, bool]:
    if len(block) % 2:
        raise ValueError("ecc-odd-length")
    out = bytearray()
    recovered = False
    for i in range(0, len(block), 2):
        hi, r1 = nibble_unhamming(block[i])
        lo, r2 = nibble_unhamming(block[i + 1])
        out.append((hi << 4) | lo)
        recovered = recovered or r1 or r2
    return bytes(out), recovered


def manchester_encode(bits: list[int]) -> list[int]:
    symbols: list[int] = []
    for bit in bits:
        if bit:
            symbols.extend([1, 0])
        else:
            symbols.extend([0, 1])
    return symbols


def manchester_decode(symbols: list[int]) -> list[int]:
    if len(symbols) % 2:
        raise ValueError("manchester-odd-length")
    bits: list[int] = []
    for i in range(0, len(symbols), 2):
        a, b = symbols[i], symbols[i + 1]
        if a == 1 and b == 0:
            bits.append(1)
        elif a == 0 and b == 1:
            bits.append(0)
        else:
            raise ValueError("manchester-violation")
    return bits


def bytes_to_bits(data: bytes) -> list[int]:
    bits: list[int] = []
    for byte in data:
        for i in range(7, -1, -1):
            bits.append((byte >> i) & 1)
    return bits


def bits_to_bytes(bits: list[int]) -> bytes:
    if len(bits) % 8:
        raise ValueError("bit-length")
    out = bytearray()
    for i in range(0, len(bits), 8):
        value = 0
        for b in bits[i : i + 8]:
            value = (value << 1) | (b & 1)
        out.append(value)
    return bytes(out)


def pack_header(version: int, station_id: int, sequence: int, message_type: int, length: int) -> bytes:
    if not 0 <= length <= MAX_PAYLOAD:
        raise ValueError("payload-too-large")
    return struct.pack(
        ">BHHBB",
        version & 0xFF,
        station_id & 0xFFFF,
        sequence & 0xFFFF,
        message_type & 0xFF,
        length & 0xFF,
    )


def unpack_header(data: bytes) -> tuple[int, int, int, int, int]:
    if len(data) < 7:
        raise ValueError("header-short")
    version, station_id, sequence, message_type, length = struct.unpack(">BHHBB", data[:7])
    return version, station_id, sequence, message_type, length


@dataclass(frozen=True)
class OpticalFrame:
    station_id: int
    sequence: int
    message_type: int
    payload: bytes
    version: int = PROTOCOL_VERSION
    recovered: bool = False

    def header_payload(self) -> bytes:
        return pack_header(self.version, self.station_id, self.sequence, self.message_type, len(self.payload)) + self.payload

    def crc16(self) -> int:
        return crc16_ccitt(self.header_payload())


@dataclass(frozen=True)
class StationObservation:
    station_id: str
    sequence: int
    timestamp_ns: int
    tag_id: str
    confidence: float = 1.0
    rssi: float = 0.0
    field_epoch: int = 0
    field_sequence: int = 0
    provenance_class: str = "physical"
    source: str = "rfid"
    instrument: str = "nfc"
    contract: str = "0.1"

    def tag_key(self) -> str:
        return hashlib.sha256(self.tag_id.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> dict:
        return {
            "contract": self.contract,
            "station_id": self.station_id,
            "sequence": self.sequence,
            "timestamp_ns": self.timestamp_ns,
            "tag_id": self.tag_id,
            "confidence": self.confidence,
            "rssi": self.rssi,
            "field_epoch": self.field_epoch,
            "field_sequence": self.field_sequence,
            "message_type": "field_observation",
            "state_hash": "",
            "provenance": {
                "class": self.provenance_class,
                "source": self.source,
                "instrument": self.instrument,
                "node_id": self.station_id,
            },
        }

    def payload_bytes(self) -> bytes:
        tag = self.tag_id.encode("ascii")[:16].ljust(16, b"\x00")
        name = self.station_id.encode("ascii")[:16].ljust(16, b"\x00")
        conf = max(0, min(255, int(round(self.confidence * 255))))
        rssi = max(0, min(255, int(round(self.rssi))))
        return struct.pack(
            ">16s16sBBIQ",
            tag,
            name,
            conf,
            rssi,
            self.field_epoch & 0xFFFFFFFF,
            self.timestamp_ns,
        )

    @classmethod
    def from_payload(cls, station_numeric: int, sequence: int, payload: bytes) -> "StationObservation":
        if len(payload) < 46:
            raise ValueError("observation-payload-short")
        tag, name, conf, rssi, epoch, ts = struct.unpack(">16s16sBBIQ", payload[:46])
        tag_id = tag.rstrip(b"\x00").decode("ascii")
        station_id = name.rstrip(b"\x00").decode("ascii") or f"station-{station_numeric:04x}"
        return cls(
            station_id=station_id,
            sequence=sequence,
            timestamp_ns=ts,
            tag_id=tag_id,
            confidence=conf / 255.0,
            rssi=float(rssi),
            field_epoch=epoch,
        )


def station_id_numeric(station_id: str) -> int:
    digest = hashlib.sha256(station_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:2], "big")
