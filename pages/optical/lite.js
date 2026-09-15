/** Short demo packet: station + seq + crc8. Fast enough to close the live loop. */

import { crc16Ccitt } from "./ecc.js";
import { LEAD_IN, PREAMBLE, bytesToBits, bitsToBytes, findPreamble } from "./frame.js";

export const LITE_BODY_BITS = 32;

export function encodeLiteFrame({ stationId, sequence }) {
  const body = Uint8Array.from([
    (stationId >> 8) & 0xff,
    stationId & 0xff,
    sequence & 0xff,
  ]);
  const crc = crc16Ccitt(body) & 0xff;
  return [...LEAD_IN, ...PREAMBLE, ...bytesToBits(body), ...bytesToBits(Uint8Array.from([crc]))];
}

export function decodeLiteSymbols(symbols) {
  const start = findPreamble(symbols);
  if (start < 0) return { frame: null, rejected: "sync-not-found", preamble: false };
  const bits = symbols.slice(start + PREAMBLE.length);
  if (bits.length < LITE_BODY_BITS) {
    return { frame: null, rejected: "frame-short", preamble: true, start };
  }
  const body = bitsToBytes(bits.slice(0, 24));
  const crc = bitsToBytes(bits.slice(24, 32))[0];
  if ((crc16Ccitt(body) & 0xff) !== crc) {
    return { frame: null, rejected: "crc-mismatch", preamble: true, start };
  }
  return {
    frame: {
      version: 1,
      stationId: (body[0] << 8) | body[1],
      sequence: body[2],
      messageType: 0,
      payload: new TextEncoder().encode("HI"),
      recovered: false,
      phy: "lite",
    },
    rejected: null,
    preamble: true,
    start,
  };
}
