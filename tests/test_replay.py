import unittest

from simulator.virtual_station import LocalField, committed_state_hash, run_loop
from optical.protocol import StationObservation


class TestReplay(unittest.TestCase):
    def test_physical_loop_hash(self) -> None:
        report = run_loop(tag_id="deadbeefcafe0001")
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["tx_hash"], report["rx_hash"])

    def test_hash_changes_with_tag(self) -> None:
        a = run_loop("aaaaaaaaaaaaaaaa")
        b = run_loop("bbbbbbbbbbbbbbbb")
        self.assertTrue(a["ok"] and b["ok"])
        self.assertNotEqual(a["tx_hash"], b["tx_hash"])

    def test_synthetic_is_rejected(self) -> None:
        field = LocalField()
        field.admit(
            StationObservation(
                station_id="s",
                sequence=1,
                timestamp_ns=0,
                tag_id="x",
                provenance_class="synthetic",
            )
        )
        self.assertEqual(field.state, {})
        self.assertEqual(field.rejected, ["not-physical"])

    def test_committed_hash_stable(self) -> None:
        h1 = committed_state_hash({"a/x": 1.0, "b/y": 2.5})
        h2 = committed_state_hash({"b/y": 2.5, "a/x": 1.0})
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 16)


if __name__ == "__main__":
    unittest.main()
