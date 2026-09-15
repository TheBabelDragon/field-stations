/** Compact camera-native optical packet.
 *
 *   PREAMBLE | VERSION | STATION | SEQ | TYPE | LEN | PAYLOAD | CRC8
 *
 * One payload byte for now. Repeat the whole packet; the decoder votes.
 */

import { crc16Ccitt } from "./ecc.js";
import { LEAD_IN, PREAMBLE, bytesToBits, bitsToBytes, findPreamble } from "./frame.js";

export const VERSION = 1;
export const TYPE = {
  HELLO: 0x00,
  SYMBOL: 0x01,
  OBSERVATION: 0x02,
};

export const TYPE_NAME = {
  0x00: "HELLO",
  0x01: "SYMBOL",
  0x02: "OBSERVATION",
};

export const BODY_BYTES = 7;
export const BODY_BITS = BODY_BYTES * 8 + 8;

export function packBytes({ stationId, sequence, type = TYPE.SYMBOL, payload = 0x67 }) {
  return Uint8Array.from([
    VERSION & 0xff,
    (stationId >> 8) & 0xff,
    stationId & 0xff,
    sequence & 0xff,
    type & 0xff,
    1,
    payload & 0xff,
  ]);
}

export function crc8(bytes) {
  return crc16Ccitt(bytes) & 0xff;
}

export function encodePacket({ stationId, sequence, type = TYPE.SYMBOL, payload = 0x67 }) {
  const body = packBytes({ stationId, sequence, type, payload });
  return [...LEAD_IN, ...PREAMBLE, ...bytesToBits(body), ...bytesToBits(Uint8Array.from([crc8(body)]))];
}

export function decodePacketSymbols(symbols) {
  const start = findPreamble(symbols);
  if (start < 0) return { packet: null, rejected: "sync-not-found", preamble: false };
  const bits = symbols.slice(start + PREAMBLE.length);
  if (bits.length < BODY_BITS) {
    return { packet: null, rejected: "frame-short", preamble: true, start, bitsHave: bits.length };
  }
  const body = bitsToBytes(bits.slice(0, BODY_BYTES * 8));
  const got = bitsToBytes(bits.slice(BODY_BYTES * 8, BODY_BITS))[0];
  if (crc8(body) !== got) {
    return { packet: null, rejected: "crc-mismatch", preamble: true, start };
  }
  const version = body[0];
  const stationId = (body[1] << 8) | body[2];
  const sequence = body[3];
  const type = body[4];
  const length = body[5];
  const payload = body[6];
  if (version !== VERSION || length !== 1) {
    return { packet: null, rejected: "header-mismatch", preamble: true, start };
  }
  return {
    packet: {
      version,
      stationId,
      sequence,
      type,
      typeName: TYPE_NAME[type] || `TYPE_${type}`,
      length,
      payload,
      crc: got,
    },
    rejected: null,
    preamble: true,
    start,
  };
}

export function formatPacket(packet) {
  const st = packet.stationId.toString(16).toUpperCase().padStart(4, "0");
  const seq = packet.sequence.toString(16).toUpperCase().padStart(4, "0");
  const sym = packet.payload.toString(16).toUpperCase().padStart(2, "0");
  const typ = packet.type.toString(16).toUpperCase().padStart(2, "0");
  return { st, seq, sym, typ, typeName: packet.typeName };
}

export function asObservation(packet) {
  const { st, seq, sym, typeName } = formatPacket(packet);
  return {
    contract: "0.1",
    message_type: "field_observation",
    station_id: st,
    sequence: packet.sequence,
    tag_id: `sym-${sym}`,
    symbol: packet.payload,
    type: typeName,
    provenance: { class: "physical", source: "optical-decoder", instrument: "camera" },
    state_hint: `${st} ${seq} ${typeName} ${sym}`,
  };
}
