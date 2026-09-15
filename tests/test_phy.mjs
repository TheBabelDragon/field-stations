import assert from "node:assert/strict";
import { encodeFrame, decodeBits, CLOCK_TRAIN, SYNC, byteBits } from "../pages/optical/phy.js";
import { recoverClockFromTrain, correlatePattern } from "../pages/optical/timing.js";
import { sliceFrom, holdCandidate } from "../pages/optical/detect.js";
import { parseBootstrap } from "../pages/station/station-config.js";

function samplesFromBits(bits, symbolMs, dt = 16, t0 = 0) {
  const samples = [];
  const total = bits.length * symbolMs;
  for (let t = 0; t <= total; t += dt) {
    const i = Math.min(bits.length - 1, Math.floor(t / symbolMs));
    samples.push({ t: t0 + t, value: bits[i] ? 0.92 : 0.08 });
  }
  return samples;
}

{
  const bits = encodeFrame({ payload: 0x67, stage: 1 });
  const decoded = decodeBits(bits, 1);
  assert.equal(decoded.rejected, null);
  assert.equal(decoded.payload, 0x67);
}

{
  const bits = encodeFrame({ stationId: 0x7f29, payload: 0xa7, stage: 2 });
  const decoded = decodeBits(bits, 2);
  assert.equal(decoded.rejected, null);
  assert.equal(decoded.stationId, 0x7f29);
  assert.equal(decoded.payload, 0xa7);
}

{
  const bits = encodeFrame({ stationId: 0x7f29, sequence: 42, payload: 0x67, stage: 3 });
  const decoded = decodeBits(bits, 3);
  assert.equal(decoded.rejected, null);
  assert.equal(decoded.stationId, 0x7f29);
  assert.equal(decoded.sequence, 42);
  assert.equal(decoded.payload, 0x67);
}

{
  const bits = encodeFrame({ stationId: 0x7f29, sequence: 42, payload: 0x67, stage: 3 });
  bits[CLOCK_TRAIN.length + SYNC.length + 10] ^= 1;
  const decoded = decodeBits(bits, 3);
  assert.equal(decoded.payload, undefined);
  assert.equal(decoded.rejected, "crc");
}

{
  const cfg = parseBootstrap("?station=7F29&sym=99&stage=1&period=200");
  assert.equal(cfg.payload, 0x99);
  const bits = encodeFrame({ payload: 0x67, stage: 1 });
  const decoded = decodeBits(bits, 1);
  assert.equal(decoded.payload, 0x67);
  assert.notEqual(decoded.payload, cfg.payload);
}

{
  const bits = encodeFrame({ payload: 0x67, stage: 1 });
  const actualMs = 120;
  const samples = samplesFromBits(bits, actualMs);
  const clock = recoverClockFromTrain(samples, 200);
  assert.ok(clock.score > 0.4, `clock score ${clock.score}`);
  assert.ok(Math.abs(clock.symbolMs - actualMs) <= 12, `period ${clock.symbolMs}`);
  const sliced = sliceFrom(samples, clock.t0, clock.symbolMs, bits.length);
  const decoded = decodeBits(sliced, 1);
  assert.equal(decoded.rejected, null, decoded.rejected);
  assert.equal(decoded.payload, 0x67);
}

{
  const bits = encodeFrame({ payload: 0x3c, stage: 1 });
  const samples = samplesFromBits(bits, 90);
  const clock = recoverClockFromTrain(samples, null);
  const sliced = sliceFrom(samples, clock.t0, clock.symbolMs, bits.length);
  const decoded = decodeBits(sliced, 1);
  assert.equal(decoded.payload, 0x3c);
}

{
  const a = { i: 3, nx: 0.2, ny: 0.2, score: 0.4 };
  const b = { i: 9, nx: 0.8, ny: 0.8, score: 0.42 };
  const held = holdCandidate(a, b, { ratio: 1.35 });
  assert.equal(held.i, 3);
  const stronger = holdCandidate(a, { ...b, score: 0.8 }, { ratio: 1.35 });
  assert.equal(stronger.i, 9);
  const frozen = holdCandidate(a, stronger, { holdAfterRx: true });
  assert.equal(frozen.i, 3);
}

{
  assert.deepEqual(CLOCK_TRAIN, [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  assert.deepEqual(SYNC, [1, 1, 0, 0, 1, 1, 0, 0]);
  const frame = encodeFrame({ payload: 0x67, stage: 1 });
  assert.deepEqual(frame.slice(0, 16), CLOCK_TRAIN);
  assert.deepEqual(frame.slice(16, 24), SYNC);
  assert.deepEqual(frame.slice(24, 32), byteBits(0x67));
}

{
  const bits = encodeFrame({ payload: 0x67, stage: 1 });
  const samples = samplesFromBits(bits, 120);
  const clock = recoverClockFromTrain(samples, 120);
  const syncHit = correlatePattern(samples, clock.symbolMs, SYNC);
  assert.ok(syncHit.score > 0.3);
  assert.ok(syncHit.t > clock.t0);
}

console.log("phy tests ok");
