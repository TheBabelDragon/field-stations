/** Bootstrap: station identity, payload symbol, elapsed-time bit period. */

export function parseBootstrap(search = window.location.search) {
  const q = new URLSearchParams(search);
  const stationRaw = (q.get("station") || "7F29").replace(/^#/, "");
  let stationId = 0x7f29;
  if (/^[0-9a-fA-F]+$/.test(stationRaw) && stationRaw.length <= 4) {
    stationId = parseInt(stationRaw, 16);
  }
  let payload = 0x67;
  const symRaw = (q.get("sym") || "67").replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{1,2}$/.test(symRaw)) payload = parseInt(symRaw, 16);
  const stage = Math.max(1, Math.min(4, Number(q.get("stage") || 1)));
  const symbolMs = Math.max(40, Number(q.get("period") || 120));
  return {
    stationParam: stationRaw.toUpperCase().padStart(4, "0"),
    stationId,
    payload,
    payloadHex: payload.toString(16).toUpperCase().padStart(2, "0"),
    payloadBits: payload.toString(2).padStart(8, "0"),
    stage,
    symbolMs,
    version: Number(q.get("v") || 1),
  };
}
