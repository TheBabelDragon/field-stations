import unittest

from optical.decoder import decode_symbols, decode_waveform
from optical.encoder import encode_observation
from optical.protocol import PREAMBLE, StationObservation
from optical.simulator import camera_observe, symbols_to_waveform


def _obs() -> StationObservation:
    return StationObservation(
        station_id="field-station-0",
        sequence=3,
        timestamp_ns=99,
        tag_id="cafebabe00000001",
        confidence=0.8,
        rssi=17,
    )


class TestCameraNative(unittest.TestCase):
    def test_clean_waveform(self) -> None:
        _, symbols = encode_observation(_obs())
        wave = symbols_to_waveform(symbols, samples_per_symbol=4)
        result = decode_waveform(wave, samples_per_symbol=4)
        self.assertIsNone(result.rejected)

    def test_midstream_lock(self) -> None:
        _, symbols = encode_observation(_obs())
        junk = [0, 1, 0, 1, 0, 0, 1] + [0] * 11
        result = decode_symbols(junk + symbols + [0, 0, 1, 0])
        self.assertIsNone(result.rejected)
        assert result.frame is not None
        back = StationObservation.from_payload(
            result.frame.station_id, result.frame.sequence, result.frame.payload
        )
        self.assertEqual(back.tag_id, "cafebabe00000001")

    def test_partial_and_blur(self) -> None:
        _, symbols = encode_observation(_obs())
        samples = camera_observe(symbols, samples_per_symbol=4, drop=5, blur=1, seed=3)
        result = decode_waveform(samples, samples_per_symbol=4)
        self.assertIsNone(result.rejected, result.rejected)

    def test_preamble_not_in_manchester(self) -> None:
        _, symbols = encode_observation(_obs())
        body = symbols[len(PREAMBLE) :]
        run = 0
        worst = 0
        for bit in body:
            run = run + 1 if bit == 1 else 0
            worst = max(worst, run)
        self.assertLess(worst, 4)

    def test_corruption_is_rejection(self) -> None:
        _, symbols = encode_observation(_obs())
        wrecked = list(symbols)
        start = len(PREAMBLE) + 24
        for i in range(start, start + 16):
            wrecked[i] ^= 1
        result = decode_symbols(wrecked)
        self.assertIsNone(result.frame)
        self.assertIsNotNone(result.rejected)


if __name__ == "__main__":
    unittest.main()
