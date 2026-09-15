import { encodeDemoFrame, encodeFrame, MESSAGE } from "./optical/frame.js";
import { packObservation } from "./protocol/field-packet.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationId = cfg.stationId || 0x7f29;
const symbolMs = Math.max(80, cfg.symbolMs || 150);
const phy = new URLSearchParams(location.search).get("phy") || "demo";

document.getElementById("station-label").textContent = stationId.toString(16).toUpperCase().padStart(4, "0");
document.getElementById("tx-meta").textContent = `${phy} PHY · ${symbolMs}ms · point phone here`;

const led = document.getElementById("tx-led");
const bitEl = document.getElementById("tx-bit");
const frameEl = document.getElementById("tx-frame");

function encodeSeq(seq) {
  const helloPay = new TextEncoder().encode("HI");
  const hello = {
    stationId,
    sequence: seq,
    messageType: MESSAGE.STATION_HELLO,
    payload: helloPay,
  };
  const obs = {
    stationId,
    sequence: seq + 100,
    messageType: MESSAGE.FIELD_OBSERVATION,
    payload: packObservation({
      tagId: "deadbeefcafe0001",
      stationId: "field-station-0",
      confidence: 0.91,
      rssi: 42,
      fieldEpoch: 1,
      timestampNs: 1_000_000_000 + seq,
    }),
  };
  const enc = phy === "v0" ? encodeFrame : encodeDemoFrame;
  return {
    symbols: [...enc(hello), ...Array(10).fill(0), ...enc(obs), ...Array(14).fill(0)],
    label: `HELLO #${seq} + OBS #${seq + 100}`,
  };
}

let pack = encodeSeq(1);
let seq = 1;
let index = 0;
let last = performance.now();

function tick(now) {
  const lag = now - last;
  if (lag >= symbolMs) {
    if (lag > symbolMs * 3) last = now;
    else last += symbolMs;
    const bit = pack.symbols[index];
    led.classList.toggle("on", bit === 1);
    bitEl.textContent = bit ? "1" : "0";
    frameEl.textContent = `${pack.label}  ·  ${index + 1}/${pack.symbols.length}`;
    index += 1;
    if (index >= pack.symbols.length) {
      seq += 1;
      pack = encodeSeq(seq);
      index = 0;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

if (navigator.wakeLock?.request) {
  navigator.wakeLock.request("screen").catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.wakeLock.request("screen").catch(() => {});
    }
  });
}
