/** OpticalFrame payload -> FieldObservation-shaped object. */

import { MESSAGE, MESSAGE_NAME } from "../optical/frame.js";

function asciiZ(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder("ascii").decode(bytes.slice(0, end));
}

export function observationFromPayload(stationNumeric, sequence, payload) {
  if (payload.length < 46) throw new Error("observation-payload-short");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const tag = asciiZ(payload.slice(0, 16));
  const name = asciiZ(payload.slice(16, 32));
  const conf = payload[32];
  const rssi = payload[33];
  const epoch = view.getUint32(34);
  const tsHi = view.getUint32(38);
  const tsLo = view.getUint32(42);
  const timestampNs = tsHi * 2 ** 32 + tsLo;
  const stationId = name || `station-${stationNumeric.toString(16).padStart(4, "0")}`;
  return {
    contract: "0.1",
    station_id: stationId,
    sequence,
    timestamp_ns: timestampNs,
    tag_id: tag,
    confidence: conf / 255,
    rssi,
    field_epoch: epoch,
    field_sequence: 0,
    message_type: "field_observation",
    state_hash: "",
    provenance: {
      class: "physical",
      source: "optical-decoder",
      instrument: "camera",
      node_id: stationId,
    },
  };
}

export function packObservation({
  tagId,
  stationId,
  confidence = 1,
  rssi = 0,
  fieldEpoch = 0,
  timestampNs = 0,
}) {
  const payload = new Uint8Array(46);
  const enc = new TextEncoder();
  const tag = enc.encode(String(tagId).slice(0, 16));
  const name = enc.encode(String(stationId).slice(0, 16));
  payload.set(tag, 0);
  payload.set(name, 16);
  payload[32] = Math.max(0, Math.min(255, Math.round(confidence * 255)));
  payload[33] = Math.max(0, Math.min(255, Math.round(rssi)));
  const view = new DataView(payload.buffer);
  view.setUint32(34, fieldEpoch >>> 0);
  const hi = Math.floor(timestampNs / 2 ** 32);
  const lo = timestampNs >>> 0;
  view.setUint32(38, hi);
  view.setUint32(42, lo);
  return payload;
}

export function describeFrame(frame) {
  const typeName = MESSAGE_NAME[frame.messageType] || `TYPE_${frame.messageType}`;
  const base = {
    version: frame.version,
    station: frame.stationId.toString(16).toUpperCase().padStart(4, "0"),
    sequence: frame.sequence,
    type: typeName,
    recovered: !!frame.recovered,
    payload_hex: [...frame.payload].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
  if (frame.messageType === MESSAGE.FIELD_OBSERVATION) {
    try {
      base.observation = observationFromPayload(frame.stationId, frame.sequence, frame.payload);
    } catch (err) {
      base.observation_error = String(err.message || err);
    }
  } else if (frame.messageType === MESSAGE.STATION_HELLO) {
    base.hello = new TextDecoder().decode(frame.payload);
  }
  return base;
}
