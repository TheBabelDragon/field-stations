"""Encode / decode / inspect optical frames from the host."""

from __future__ import annotations

import argparse
import json
import sys
import time

from optical.decoder import decode_symbols
from optical.encoder import encode_observation
from optical.protocol import StationObservation, station_id_numeric


def cmd_encode(args: argparse.Namespace) -> int:
    obs = StationObservation(
        station_id=args.station,
        sequence=args.sequence,
        timestamp_ns=args.timestamp or time.time_ns(),
        tag_id=args.tag,
        confidence=args.confidence,
        rssi=args.rssi,
    )
    frame, symbols = encode_observation(obs)
    doc = {
        "station_numeric": frame.station_id,
        "sequence": frame.sequence,
        "message_type": frame.message_type,
        "crc16": hex(frame.crc16()),
        "payload_hex": frame.payload.hex(),
        "symbols": "".join("1" if s else "0" for s in symbols),
        "symbol_count": len(symbols),
        "observation": obs.to_dict(),
    }
    print(json.dumps(doc, indent=2))
    return 0


def cmd_decode(args: argparse.Namespace) -> int:
    raw = args.symbols.strip()
    symbols = [1 if ch == "1" else 0 for ch in raw if ch in "01"]
    result = decode_symbols(symbols)
    if result.rejected or result.frame is None:
        print(json.dumps({"ok": False, "rejected": result.rejected}))
        return 1
    frame = result.frame
    try:
        obs = StationObservation.from_payload(frame.station_id, frame.sequence, frame.payload)
        observation = obs.to_dict()
    except ValueError:
        observation = None
    print(
        json.dumps(
            {
                "ok": True,
                "station_id": frame.station_id,
                "sequence": frame.sequence,
                "message_type": frame.message_type,
                "recovered": frame.recovered,
                "payload_hex": frame.payload.hex(),
                "observation": observation,
            },
            indent=2,
        )
    )
    return 0


def cmd_id(args: argparse.Namespace) -> int:
    print(f"{args.station} -> {station_id_numeric(args.station):04x}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="station-tools")
    sub = parser.add_subparsers(dest="cmd", required=True)

    enc = sub.add_parser("encode", help="RFID-shaped observation -> optical symbols")
    enc.add_argument("--tag", required=True)
    enc.add_argument("--station", default="field-station-0")
    enc.add_argument("--sequence", type=int, default=1)
    enc.add_argument("--confidence", type=float, default=1.0)
    enc.add_argument("--rssi", type=float, default=0.0)
    enc.add_argument("--timestamp", type=int, default=0)
    enc.set_defaults(func=cmd_encode)

    dec = sub.add_parser("decode", help="01 symbol string -> frame")
    dec.add_argument("symbols")
    dec.set_defaults(func=cmd_decode)

    ident = sub.add_parser("id", help="station name -> 16-bit optical id")
    ident.add_argument("station")
    ident.set_defaults(func=cmd_id)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
