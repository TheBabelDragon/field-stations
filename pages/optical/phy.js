/** Staged camera PHY. Prove raw bits before packets.
 *
 * stage 1: 00000000 + SYMBOL bits, repeat
 * stage 2: preamble + SYMBOL
 * stage 3: preamble + STATION + SYMBOL
 * stage 4: preamble + STATION + SEQ + SYMBOL + CRC8
 */

import { crc16Ccitt } from "./ecc.js";
import { PREAMBLE, LEAD_IN, bytesToBits, bitsToBytes, findPreamble } from "./frame.js";

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

export function encodeStage(stage, { stationId = 0x7f29, sequence = 1, payload = 0x67 }) {
  const symbol = byteBits(payload);
  const quiet = [0, 0, 0, 0, 0, 0, 0, 0];
  if (stage <= 1) return [...quiet, ...symbol];
  if (stage === 2) return [...LEAD_IN, ...PREAMBLE, ...symbol, ...quiet];
  if (stage === 3) {
    return [...LEAD_IN, ...PREAMBLE, ...bytesToBits(Uint8Array.from([
      (stationId >> 8) & 0xff,
      stationId & 0xff,
      payload & 0xff,
    ])), ...quiet];
  }
  const body = Uint8Array.from([
    (stationId >> 8) & 0xff,
    stationId & 0xff,
    sequence & 0xff,
    payload & 0xff,
  ]);
  const crc = crc16Ccitt(body) & 0xff;
  return [...LEAD_IN, ...PREAMBLE, ...bytesToBits(body), ...bytesToBits(Uint8Array.from([crc])), ...quiet];
}

export function decodeStage(stage, symbols, expect = {}) {
  const raw = symbols.join("");
  if (stage <= 1) {
    const target = byteBits(expect.payload ?? 0x67).join("");
    const hit = raw.indexOf(target);
    if (hit < 0) return { raw, rejected: "pattern-miss" };
    return { raw, payload: expect.payload ?? 0x67, rejected: null };
  }
  const start = findPreamble(symbols);
  if (start < 0) return { raw, rejected: "sync-not-found", preamble: false };
  const body = symbols.slice(start + PREAMBLE.length);
  if (stage === 2) {
    if (body.length < 8) return { raw, rejected: "frame-short", preamble: true };
    return { raw, payload: bitsByte(body.slice(0, 8)), preamble: true, rejected: null };
  }
  if (stage === 3) {
    if (body.length < 24) return { raw, rejected: "frame-short", preamble: true };
    const bytes = bitsToBytes(body.slice(0, 24));
    return {
      raw,
      preamble: true,
      stationId: (bytes[0] << 8) | bytes[1],
      payload: bytes[2],
      rejected: null,
    };
  }
  if (body.length < 40) return { raw, rejected: "frame-short", preamble: true };
  const bytes = bitsToBytes(body.slice(0, 32));
  const crc = bitsToBytes(body.slice(32, 40))[0];
  if ((crc16Ccitt(bytes) & 0xff) !== crc) {
    return { raw, preamble: true, rejected: "crc-mismatch" };
  }
  return {
    raw,
    preamble: true,
    stationId: (bytes[0] << 8) | bytes[1],
    sequence: bytes[2],
    payload: bytes[3],
    rejected: null,
  };
}

export function estimateSymbolMs(samples) {
  if (samples.length < 12) return null;
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  if (max - min < 0.12) return null;
  const mid = (min + max) / 2;
  const runs = [];
  let last = samples[0].value >= mid;
  let t = samples[0].t;
  for (let i = 1; i < samples.length; i++) {
    const on = samples[i].value >= mid;
    if (on !== last) {
      const dur = samples[i].t - t;
      if (dur > 30 && dur < 400) runs.push(dur);
      t = samples[i].t;
      last = on;
    }
  }
  if (runs.length < 4) return null;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

export function sliceRaw(samples, symbolMs) {
  if (samples.length < 4) return [];
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  const mid = (min + max) / 2;
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const bits = [];
  for (let t = t0; t + symbolMs * 0.6 <= t1; t += symbolMs) {
    const a = t + symbolMs * 0.3;
    const b = t + symbolMs * 0.7;
    let sum = 0;
    let n = 0;
    for (const s of samples) {
      if (s.t >= a && s.t < b) {
        sum += s.value;
        n++;
      }
    }
    if (!n) continue;
    bits.push(sum / n >= mid ? 1 : 0);
  }
  return bits;
}
