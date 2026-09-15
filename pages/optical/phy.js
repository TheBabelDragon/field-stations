/** Camera PHY: clock train, then sync, then payload.
 * Clock is recovered from 1010 runs, not from payload runs or samples[0].
 */

import { crc16Ccitt } from "./ecc.js";
import { bytesToBits, bitsToBytes } from "./frame.js";

export const CLOCK_TRAIN = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
export const SYNC = [1, 1, 0, 0, 1, 1, 0, 0];

export function byteBits(value) {
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push((value >> i) & 1);
  return bits;
}

export function bitsByte(bits) {
  let v = 0;
  for (let i = 0; i < 8; i++) v = (v << 1) | (bits[i] & 1);
  return v;
}

export function encodeFrame({ stationId = 0x7f29, sequence = 1, payload = 0x67, stage = 1 }) {
  const tail = [];
  if (stage <= 1) tail.push(...byteBits(payload));
  else if (stage === 2) tail.push(...bytesToBits(Uint8Array.from([(stationId >> 8) & 0xff, stationId & 0xff, payload])));
  else {
    const body = Uint8Array.from([
      (stationId >> 8) & 0xff,
      stationId & 0xff,
      sequence & 0xff,
      payload & 0xff,
    ]);
    tail.push(...bytesToBits(body), ...byteBits(crc16Ccitt(body) & 0xff));
  }
  return [...CLOCK_TRAIN, ...SYNC, ...tail, 0, 0, 0, 0];
}

export function findPattern(bits, pattern, maxDist = 1) {
  let best = { i: -1, d: 99 };
  for (let i = 0; i <= bits.length - pattern.length; i++) {
    let d = 0;
    for (let j = 0; j < pattern.length; j++) if (bits[i + j] !== pattern[j]) d++;
    if (d < best.d) best = { i, d };
    if (d === 0) return best;
  }
  return best.d <= maxDist ? best : { i: -1, d: best.d };
}

export function decodeBits(bits, stage = 1) {
  const clock = findPattern(bits, CLOCK_TRAIN, 2);
  if (clock.i < 0) return { rejected: "no-clock", clock };
  const afterClock = bits.slice(clock.i + CLOCK_TRAIN.length);
  const sync = findPattern(afterClock, SYNC, 1);
  if (sync.i < 0) return { rejected: "no-sync", clock, preamble: true };
  const body = afterClock.slice(sync.i + SYNC.length);
  if (stage <= 1) {
    if (body.length < 8) return { rejected: "short", clock, sync, preamble: true };
    return { rejected: null, clock, sync, preamble: true, payload: bitsByte(body.slice(0, 8)) };
  }
  if (stage === 2) {
    if (body.length < 24) return { rejected: "short", clock, sync, preamble: true };
    const bytes = bitsToBytes(body.slice(0, 24));
    return {
      rejected: null,
      clock,
      sync,
      preamble: true,
      stationId: (bytes[0] << 8) | bytes[1],
      payload: bytes[2],
    };
  }
  if (body.length < 40) return { rejected: "short", clock, sync, preamble: true };
  const bytes = bitsToBytes(body.slice(0, 32));
  const crc = bitsByte(body.slice(32, 40));
  if ((crc16Ccitt(bytes) & 0xff) !== crc) {
    return { rejected: "crc", clock, sync, preamble: true };
  }
  return {
    rejected: null,
    clock,
    sync,
    preamble: true,
    stationId: (bytes[0] << 8) | bytes[1],
    sequence: bytes[2],
    payload: bytes[3],
  };
}
