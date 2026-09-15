/** Bootstrap QR -> decoder context. Station id comes from the QR, not the LED. */

export function parseBootstrap(search = window.location.search) {
  const q = new URLSearchParams(search);
  const stationRaw = (q.get("station") || "7F29").replace(/^#/, "");
  const frames = Math.max(3, Number(q.get("frames") || 4));
  const symbolMs = Number(q.get("sym") || Math.round(frames * (1000 / 60)));
  let stationId = 0x7f29;
  if (/^[0-9a-fA-F]+$/.test(stationRaw) && stationRaw.length <= 4) {
    stationId = parseInt(stationRaw, 16);
  }
  return {
    stationParam: stationRaw.toUpperCase(),
    stationId,
    version: Number(q.get("v") || 1),
    symbolMs,
    frames,
    channel: "single-led",
    expectedLocation: "center",
    url: typeof window !== "undefined" ? window.location.href : "",
  };
}
