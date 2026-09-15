/** Screen-camera PHY: preamble + sequence sent three times. 2-of-3 vote is the lock. */

import { LEAD_IN, PREAMBLE, findPreamble } from "./frame.js";

export const LITE_BODY_BITS = 24;

export function byteToBits(value) {
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push((value >> i) & 1);
  return bits;
}

export function bitsToByte(bits) {
  let value = 0;
  for (let i = 0; i < 8; i++) value = (value << 1) | (bits[i] & 1);
  return value;
}

export function encodeLiteFrame({ sequence }) {
  const seqBits = byteToBits(sequence & 0xff);
  return [...LEAD_IN, ...PREAMBLE, ...seqBits, ...seqBits, ...seqBits];
}

export function decodeLiteSymbols(symbols) {
  const start = findPreamble(symbols);
  if (start < 0) return { frame: null, rejected: "sync-not-found", preamble: false };
  const bits = symbols.slice(start + PREAMBLE.length);
  if (bits.length < LITE_BODY_BITS) {
    return { frame: null, rejected: "frame-short", preamble: true, start };
  }
  const voted = [];
  let agrees = 0;
  for (let i = 0; i < 8; i++) {
    const s = (bits[i] | 0) + (bits[8 + i] | 0) + (bits[16 + i] | 0);
    const bit = s >= 2 ? 1 : 0;
    voted.push(bit);
    if (bits[i] === bits[8 + i] && bits[8 + i] === bits[16 + i]) agrees += 1;
  }
  if (agrees < 5) {
    return { frame: null, rejected: "vote-fail", preamble: true, start };
  }
  const sequence = bitsToByte(voted);
  return {
    frame: {
      version: 1,
      stationId: 0,
      sequence,
      messageType: 0,
      payload: new TextEncoder().encode(String(sequence)),
      recovered: true,
      phy: "lite3",
      agrees,
    },
    rejected: null,
    preamble: true,
    start,
  };
}
