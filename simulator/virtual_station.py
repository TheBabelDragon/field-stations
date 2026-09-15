"""RFID -> observation -> FieldTick-shaped state -> LED -> camera -> decoder.

No Field OS import. This repo must run alone. The tick here is a
local admitted-state stand-in whose hash is compared after the
physical (simulated) loop.
"""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field

from optical.decoder import decode_waveform
from optical.encoder import encode_observation
from optical.protocol import StationObservation
from optical.simulator import camera_observe


def committed_state_hash(state: dict[str, float], contract: str = "0.1") -> str:
    items = sorted((k, f"{v:.9g}") for k, v in state.items())
    blob = json.dumps(
        {"contract": contract, "state": items},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


@dataclass
class LocalField:
    state: dict[str, float] = field(default_factory=dict)
    rejected: list[str] = field(default_factory=list)
    ticks: int = 0

    def admit(self, obs: StationObservation) -> None:
        if obs.provenance_class != "physical":
            self.rejected.append("not-physical")
            return
        if not obs.tag_id:
            self.rejected.append("empty-tag")
            return
        cell = obs.station_id
        self.state[f"{cell}/tag.present"] = 1.0
        self.state[f"{cell}/tag.confidence"] = float(obs.confidence)
        digest = int(obs.tag_key()[:8], 16)
        self.state[f"{cell}/tag.identity"] = float(digest & 0xFFFFFF)
        self.ticks += 1

    def hash(self) -> str:
        return committed_state_hash(self.state)


def run_loop(tag_id: str = "deadbeefcafe0001", station_id: str = "field-station-0") -> dict:
    obs = StationObservation(
        station_id=station_id,
        sequence=1,
        timestamp_ns=1_000_000_000,
        tag_id=tag_id,
        confidence=0.91,
        rssi=42,
        field_epoch=1,
    )
    frame, symbols = encode_observation(obs)
    wire = StationObservation.from_payload(frame.station_id, frame.sequence, frame.payload)
    tx_field = LocalField()
    tx_field.admit(wire)
    tx_hash = tx_field.hash()

    samples = camera_observe(symbols, samples_per_symbol=4, drop=3, blur=1, seed=7)
    result = decode_waveform(samples, samples_per_symbol=4)
    if result.rejected or result.frame is None:
        return {
            "ok": False,
            "rejected": result.rejected,
            "tx_hash": tx_hash,
        }

    recovered = StationObservation.from_payload(
        result.frame.station_id,
        result.frame.sequence,
        result.frame.payload,
    )
    rx_field = LocalField()
    rx_field.admit(recovered)
    rx_hash = rx_field.hash()
    return {
        "ok": tx_hash == rx_hash and recovered.tag_id == obs.tag_id,
        "tag_id": recovered.tag_id,
        "tx_hash": tx_hash,
        "rx_hash": rx_hash,
        "recovered_ecc": result.frame.recovered,
        "symbols": len(symbols),
        "samples": len(samples),
        "station": hex(result.frame.station_id),
        "sequence": result.frame.sequence,
    }


def main() -> int:
    report = run_loop()
    print(json.dumps(report, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
