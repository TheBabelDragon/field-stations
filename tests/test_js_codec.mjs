import assert from "node:assert/strict";
import { crc16Ccitt, nibbleHamming, nibbleUnhamming, eccEncode, eccDecode } from "../pages/optical/ecc.js";
import { decodeSymbols, encodeFrame, MESSAGE } from "../pages/optical/frame.js";
import { observationFromPayload, packObservation } from "../pages/protocol/field-packet.js";

const crc = crc16Ccitt(new TextEncoder().encode("123456789"));
assert.equal(crc, 0x29b1);

for (let n = 0; n < 16; n++) {
  const { nibble, recovered } = nibbleUnhamming(nibbleHamming(n));
  assert.equal(nibble, n);
  assert.equal(recovered, false);
}

const payload = packObservation({
  tagId: "deadbeefcafe0001",
  stationId: "field-station-0",
  confidence: 0.5,
  rssi: 10,
  fieldEpoch: 3,
  timestampNs: 42,
});
const symbols = encodeFrame({
  stationId: 0x7f29,
  sequence: 9,
  messageType: MESSAGE.FIELD_OBSERVATION,
  payload,
});
const mid = [0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, ...symbols, 0, 0, 1];
const result = decodeSymbols(mid);
assert.equal(result.rejected, null);
assert.ok(result.frame);
assert.equal(result.frame.stationId, 0x7f29);
assert.equal(result.frame.sequence, 9);
const obs = observationFromPayload(result.frame.stationId, result.frame.sequence, result.frame.payload);
assert.equal(obs.tag_id, "deadbeefcafe0001");
assert.equal(obs.station_id, "field-station-0");
assert.ok(Math.abs(obs.confidence - 0.5) < 0.01);

const block = eccEncode(new TextEncoder().encode("field-os"));
block[0] ^= 0x80;
const repaired = eccDecode(block);
assert.equal(new TextDecoder().decode(repaired.bytes), "field-os");
assert.equal(repaired.recovered, true);

const wrecked = symbols.slice();
for (let i = 40; i < 56; i++) wrecked[i] ^= 1;
const bad = decodeSymbols(wrecked);
assert.equal(bad.frame, null);
assert.ok(bad.rejected);

console.log("js codec ok");
