/** Logical symbols <-> OpticalFrame. Independent of camera modulation. */

import { crc16Ccitt, eccDecode, eccEncode } from "./ecc.js";

export const PROTOCOL_VERSION = 1;
export const PREAMBLE = [1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0];
export const LEAD_IN = [0, 0, 0, 0, 0, 0, 0, 0];
export const MAX_PAYLOAD = 64;

export const MESSAGE = {
  STATION_HELLO: 0x00,
  FIELD_OBSERVATION: 0x01,
  FIELD_TICK: 0x02,
  STATE_HASH: 0x03,
  REJECTED: 0x04,
};

export const MESSAGE_NAME = {
  0x00: "HELLO",
  0x01: "FIELD_OBSERVATION",
  0x02: "FIELD_TICK",
  0x03: "STATE_HASH",
  0x04: "REJECTED",
};

export function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

export function bitsToBytes(bits) {
  if (bits.length % 8) throw new Error("bit-length");
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] & 1);
    out.push(value);
  }
  return Uint8Array.from(out);
}

export function manchesterEncode(bits) {
  const symbols = [];
  for (const bit of bits) {
    if (bit) symbols.push(1, 0);
    else symbols.push(0, 1);
  }
  return symbols;
}

export function manchesterDecode(symbols) {
  if (symbols.length % 2) throw new Error("manchester-odd-length");
  const bits = [];
  for (let i = 0; i < symbols.length; i += 2) {
    const a = symbols[i];
    const b = symbols[i + 1];
    if (a === 1 && b === 0) bits.push(1);
    else if (a === 0 && b === 1) bits.push(0);
    else throw new Error("manchester-violation");
  }
  return bits;
}

export function packHeader(version, stationId, sequence, messageType, length) {
  if (length < 0 || length > MAX_PAYLOAD) throw new Error("payload-too-large");
  const buf = new ArrayBuffer(7);
  const view = new DataView(buf);
  view.setUint8(0, version & 0xff);
  view.setUint16(1, stationId & 0xffff);
  view.setUint16(3, sequence & 0xffff);
  view.setUint8(5, messageType & 0xff);
  view.setUint8(6, length & 0xff);
  return new Uint8Array(buf);
}

export function unpackHeader(bytes) {
  if (bytes.length < 7) throw new Error("header-short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: view.getUint8(0),
    stationId: view.getUint16(1),
    sequence: view.getUint16(3),
    messageType: view.getUint8(5),
    length: view.getUint8(6),
  };
}

export function encodeFrame({ stationId, sequence, messageType, payload, version = PROTOCOL_VERSION }) {
  const body = new Uint8Array(7 + payload.length);
  body.set(packHeader(version, stationId, sequence, messageType, payload.length), 0);
  body.set(payload, 7);
  const crc = crc16Ccitt(body);
  const protectedBytes = new Uint8Array(body.length + 2);
  protectedBytes.set(body, 0);
  protectedBytes[body.length] = (crc >> 8) & 0xff;
  protectedBytes[body.length + 1] = crc & 0xff;
  const ecc = eccEncode(protectedBytes);
  const framed = new Uint8Array(1 + ecc.length);
  framed[0] = ecc.length;
  framed.set(ecc, 1);
  return [...LEAD_IN, ...PREAMBLE, ...manchesterEncode(bytesToBits(framed))];
}

/** Screen/camera demo PHY: same header+CRC, no ECC, no Manchester. Short enough to lock live. */
export function encodeDemoFrame({ stationId, sequence, messageType, payload, version = PROTOCOL_VERSION }) {
  const body = new Uint8Array(7 + payload.length);
  body.set(packHeader(version, stationId, sequence, messageType, payload.length), 0);
  body.set(payload, 7);
  const crc = crc16Ccitt(body);
  const crcBytes = Uint8Array.from([(crc >> 8) & 0xff, crc & 0xff]);
  return [...LEAD_IN, ...PREAMBLE, ...bytesToBits(body), ...bytesToBits(crcBytes)];
}

export function findPreamble(symbols) {
  const n = PREAMBLE.length;
  for (let i = 0; i <= symbols.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (symbols[i + j] !== PREAMBLE[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function takeManchester(symbols, nBits) {
  const need = nBits * 2;
  if (symbols.length < need) throw new Error("frame-short");
  return manchesterDecode(symbols.slice(0, need));
}

export function decodeSymbols(symbols) {
  const start = findPreamble(symbols);
  if (start < 0) return { frame: null, rejected: "sync-not-found", start: 0, end: 0, preamble: false };
  const body = symbols.slice(start + PREAMBLE.length);
  try {
    const lenBits = takeManchester(body, 8);
    const eccLen = bitsToBytes(lenBits)[0];
    const restBits = takeManchester(body.slice(16), 8 * eccLen);
    const ecc = bitsToBytes(restBits);
    if (ecc.length !== eccLen) return { frame: null, rejected: "ecc-truncated", start, end: symbols.length, preamble: true };
    const { bytes: protectedBytes, recovered } = eccDecode(ecc);
    if (protectedBytes.length < 9) return { frame: null, rejected: "protected-short", start, end: symbols.length, preamble: true };
    const bodyBytes = protectedBytes.slice(0, -2);
    const crcBytes = protectedBytes.slice(-2);
    const expect = crc16Ccitt(bodyBytes);
    const got = (crcBytes[0] << 8) | crcBytes[1];
    if (expect !== got) return { frame: null, rejected: "crc-mismatch", start, end: symbols.length, preamble: true };
    const header = unpackHeader(bodyBytes);
    const payload = bodyBytes.slice(7, 7 + header.length);
    if (payload.length !== header.length) {
      return { frame: null, rejected: "payload-truncated", start, end: symbols.length, preamble: true };
    }
    return {
      frame: {
        version: header.version,
        stationId: header.stationId,
        sequence: header.sequence,
        messageType: header.messageType,
        payload,
        recovered,
        phy: "v0",
      },
      rejected: null,
      start,
      end: start + PREAMBLE.length + 16 + eccLen * 16,
      preamble: true,
    };
  } catch (err) {
    return { frame: null, rejected: String(err.message || err), start, end: symbols.length, preamble: true };
  }
}

export function decodeDemoSymbols(symbols) {
  const start = findPreamble(symbols);
  if (start < 0) return { frame: null, rejected: "sync-not-found", start: 0, end: 0, preamble: false };
  const bits = symbols.slice(start + PREAMBLE.length);
  if (bits.length < 56 + 16) {
    return { frame: null, rejected: "frame-short", start, end: symbols.length, preamble: true };
  }
  try {
    const header = unpackHeader(bitsToBytes(bits.slice(0, 56)));
    const need = 56 + header.length * 8 + 16;
    if (bits.length < need) {
      return { frame: null, rejected: "frame-short", start, end: symbols.length, preamble: true };
    }
    const payloadBits = bits.slice(56, 56 + header.length * 8);
    const crcBits = bits.slice(56 + header.length * 8, need);
    if (payloadBits.length % 8 || crcBits.length !== 16) {
      return { frame: null, rejected: "bit-length", start, end: symbols.length, preamble: true };
    }
    const payload = bitsToBytes(payloadBits);
    const crcBytes = bitsToBytes(crcBits);
    const body = new Uint8Array(7 + payload.length);
    body.set(packHeader(header.version, header.stationId, header.sequence, header.messageType, header.length), 0);
    body.set(payload, 7);
    const expect = crc16Ccitt(body);
    const got = (crcBytes[0] << 8) | crcBytes[1];
    if (expect !== got) return { frame: null, rejected: "crc-mismatch", start, end: start + PREAMBLE.length + need, preamble: true };
    return {
      frame: {
        version: header.version,
        stationId: header.stationId,
        sequence: header.sequence,
        messageType: header.messageType,
        payload,
        recovered: false,
        phy: "demo",
      },
      rejected: null,
      start,
      end: start + PREAMBLE.length + need,
      preamble: true,
    };
  } catch (err) {
    return { frame: null, rejected: String(err.message || err), start, end: symbols.length, preamble: true };
  }
}
