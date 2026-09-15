/** Bootstrap QR -> decoder context.
 * station = who. sym = payload byte on the wire. frames = camera-safe timing.
 */

export function parseBootstrap(search = window.location.search) {
  const q = new URLSearchParams(search);
  const stationRaw = (q.get("station") || "7F29").replace(/^#/, "");
  const frames = Math.max(3, Number(q.get("frames") || 4));
  const period = Number(q.get("period") || 0);
  const symbolMs = period || Math.round(frames * (1000 / 60));
  let stationId = 0x7f29;
  if (/^[0-9a-fA-F]+$/.test(stationRaw) && stationRaw.length <= 4) {
    stationId = parseInt(stationRaw, 16);
  }
  let payload = 0x67;
  const symRaw = (q.get("sym") || "67").replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{1,2}$/.test(symRaw)) payload = parseInt(symRaw, 16);
  return {
    stationParam: stationRaw.toUpperCase().padStart(4, "0"),
    stationId,
    version: Number(q.get("v") || 1),
    payload,
    payloadHex: payload.toString(16).toUpperCase().padStart(2, "0"),
    frames,
    symbolMs,
    channel: "single-led",
    expectedLocation: "center",
    url: typeof window !== "undefined" ? window.location.href : "",
  };
}
