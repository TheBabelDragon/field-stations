/** Bootstrap QR -> decoder context. The QR does not carry live payload. */

export function parseBootstrap(search = window.location.search) {
  const q = new URLSearchParams(search);
  const stationRaw = (q.get("station") || "").replace(/^#/, "");
  let stationId = null;
  if (/^[0-9a-fA-F]+$/.test(stationRaw) && stationRaw.length <= 4) {
    stationId = parseInt(stationRaw, 16);
  } else if (stationRaw) {
    return {
      stationParam: stationRaw,
      stationId: null,
      version: Number(q.get("v") || 1),
      symbolMs: Number(q.get("sym") || 80),
      channel: q.get("channel") || "single-led",
      expectedLocation: q.get("led") || "center",
      url: typeof window !== "undefined" ? window.location.href : "",
    };
  }
  return {
    stationParam: stationRaw || "0000",
    stationId: stationId == null ? 0 : stationId,
    version: Number(q.get("v") || 1),
    symbolMs: Number(q.get("sym") || 80),
    channel: q.get("channel") || "single-led",
    expectedLocation: q.get("led") || "center",
    url: typeof window !== "undefined" ? window.location.href : "",
  };
}

export function bootstrapUrl({ origin, station = "7F29", version = 1, symbolMs = 80 }) {
  const base = origin.replace(/\/$/, "");
  return `${base}/decode.html?station=${String(station).toUpperCase()}&v=${version}&sym=${symbolMs}`;
}

export const DEFAULT_OPTICAL = {
  channel: "single-led",
  expected_location: "center",
};
