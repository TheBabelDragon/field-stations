"""Symbol / waveform -> OpticalFrame.

The decoder must lock if the camera starts mid-transmission:
it searches for PREAMBLE anywhere in the symbol stream.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .protocol import (
    PREAMBLE,
    OpticalFrame,
    bits_to_bytes,
    crc16_ccitt,
    ecc_decode,
    manchester_decode,
    unpack_header,
)


@dataclass
class DecodeResult:
    frame: Optional[OpticalFrame]
    rejected: Optional[str]
    start: int = 0
    end: int = 0


def find_preamble(symbols: list[int]) -> int:
    n = len(PREAMBLE)
    for i in range(0, len(symbols) - n + 1):
        if tuple(symbols[i : i + n]) == PREAMBLE:
            return i
    return -1


def _take_manchester(symbols: list[int], n_bits: int) -> list[int]:
    need = n_bits * 2
    if len(symbols) < need:
        raise ValueError("frame-short")
    return manchester_decode(symbols[:need])


def _decode_from(symbols: list[int], start: int) -> DecodeResult:
    body = symbols[start + len(PREAMBLE) :]
    try:
        len_bits = _take_manchester(body, 8)
        ecc_len = bits_to_bytes(len_bits)[0]
        rest_bits = _take_manchester(body[16:], 8 * ecc_len)
        ecc = bits_to_bytes(rest_bits)
    except ValueError as exc:
        return DecodeResult(None, str(exc), start, len(symbols))
    if len(ecc) != ecc_len:
        return DecodeResult(None, "ecc-truncated", start, len(symbols))
    try:
        protected, recovered = ecc_decode(ecc)
    except ValueError as exc:
        return DecodeResult(None, str(exc), start, len(symbols))
    if len(protected) < 9:
        return DecodeResult(None, "protected-short", start, len(symbols))
    body_bytes, crc_bytes = protected[:-2], protected[-2:]
    expect = crc16_ccitt(body_bytes)
    got = int.from_bytes(crc_bytes, "big")
    if expect != got:
        return DecodeResult(None, "crc-mismatch", start, len(symbols))
    version, station_id, sequence, message_type, length = unpack_header(body_bytes)
    payload = body_bytes[7 : 7 + length]
    if len(payload) != length:
        return DecodeResult(None, "payload-truncated", start, len(symbols))
    frame = OpticalFrame(
        version=version,
        station_id=station_id,
        sequence=sequence,
        message_type=message_type,
        payload=payload,
        recovered=recovered,
    )
    consumed_symbols = len(PREAMBLE) + 16 + ecc_len * 16
    return DecodeResult(frame, None, start, start + consumed_symbols)


def decode_symbols(symbols: list[int]) -> DecodeResult:
    idx = find_preamble(symbols)
    if idx < 0:
        return DecodeResult(None, "sync-not-found")
    return _decode_from(symbols, idx)


def waveform_to_symbols(samples: list[float], samples_per_symbol: int, threshold: float | None = None) -> list[int]:
    """Slice a brightness timeline into OOK symbols.

    Camera-native v0: integrate each symbol window and threshold.
    Rolling shutter / exposure show up as soft edges; the integrator
    still yields a usable bit if the window covers most of the symbol.
    """
    if samples_per_symbol < 1:
        raise ValueError("samples-per-symbol")
    if threshold is None:
        threshold = (max(samples) + min(samples)) / 2.0 if samples else 0.5
    symbols: list[int] = []
    for i in range(0, len(samples) - samples_per_symbol + 1, samples_per_symbol):
        window = samples[i : i + samples_per_symbol]
        symbols.append(1 if sum(window) / len(window) >= threshold else 0)
    return symbols


def decode_waveform(samples: list[float], samples_per_symbol: int, threshold: float | None = None) -> DecodeResult:
    """Try every sampling phase. Cameras do not promise symbol alignment."""
    last = DecodeResult(None, "sync-not-found")
    for phase in range(samples_per_symbol):
        sliced = waveform_to_symbols(samples[phase:], samples_per_symbol, threshold)
        result = decode_symbols(sliced)
        if result.frame is not None:
            return result
        last = result
    return last
