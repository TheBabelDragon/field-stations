import unittest

from optical.decoder import decode_symbols
from optical.encoder import encode_frame, encode_observation
from optical.protocol import (
    MESSAGE_FIELD_OBSERVATION,
    OpticalFrame,
    StationObservation,
    crc16_ccitt,
    ecc_decode,
    ecc_encode,
    nibble_hamming,
    nibble_unhamming,
)


class TestEcc(unittest.TestCase):
    def test_nibble_roundtrip(self) -> None:
        for n in range(16):
            code = nibble_hamming(n)
            got, recovered = nibble_unhamming(code)
            self.assertEqual(got, n)
            self.assertFalse(recovered)

    def test_single_bit_repair(self) -> None:
        code = nibble_hamming(0b1010)
        for bit in range(8):
            flipped = code ^ (1 << bit)
            got, recovered = nibble_unhamming(flipped)
            self.assertEqual(got, 0b1010)
            self.assertTrue(recovered)

    def test_payload_ecc(self) -> None:
        payload = b"field-os"
        block = ecc_encode(payload)
        block = bytes([block[0] ^ 0x80]) + block[1:]
        got, recovered = ecc_decode(block)
        self.assertEqual(got, payload)
        self.assertTrue(recovered)


class TestCrc(unittest.TestCase):
    def test_known_vector(self) -> None:
        self.assertEqual(crc16_ccitt(b"123456789"), 0x29B1)


class TestFrame(unittest.TestCase):
    def test_observation_roundtrip(self) -> None:
        obs = StationObservation(
            station_id="field-station-0",
            sequence=9,
            timestamp_ns=42,
            tag_id="deadbeefcafe0001",
            confidence=0.5,
            rssi=10,
        )
        frame, symbols = encode_observation(obs)
        self.assertEqual(frame.message_type, MESSAGE_FIELD_OBSERVATION)
        result = decode_symbols(symbols)
        self.assertIsNone(result.rejected)
        assert result.frame is not None
        back = StationObservation.from_payload(
            result.frame.station_id, result.frame.sequence, result.frame.payload
        )
        self.assertEqual(back.tag_id, obs.tag_id)
        self.assertEqual(back.station_id, obs.station_id)
        self.assertEqual(back.sequence, obs.sequence)
        self.assertAlmostEqual(back.confidence, obs.confidence, places=2)

    def test_hello_frame(self) -> None:
        frame = OpticalFrame(station_id=1, sequence=0, message_type=0, payload=b"hi")
        result = decode_symbols(encode_frame(frame))
        self.assertIsNone(result.rejected)
        assert result.frame is not None
        self.assertEqual(result.frame.payload, b"hi")


if __name__ == "__main__":
    unittest.main()
