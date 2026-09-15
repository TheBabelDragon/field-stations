import { encodeLiteFrame } from "./optical/lite.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationId = cfg.stationId || 0x7f29;
const symbolMs = Math.max(120, cfg.symbolMs || 200);

document.getElementById("station-label").textContent = stationId.toString(16).toUpperCase().padStart(4, "0");

const led = document.getElementById("tx-led");
const bitEl = document.getElementById("tx-bit");
const frameEl = document.getElementById("tx-frame");
const meta = document.getElementById("tx-meta");

function pack(seq) {
  return [...encodeLiteFrame({ stationId, sequence: seq }), ...Array(6).fill(0)];
}

let seq = 1;
let symbols = pack(seq);
let index = 0;
let last = performance.now();
meta.textContent = `lite PHY · ${symbolMs}ms · ${symbols.length} symbols · tap for fullscreen`;

function tick(now) {
  if (now - last >= symbolMs) {
    if (now - last > symbolMs * 4) last = now;
    else last += symbolMs;
    const bit = symbols[index];
    led.classList.toggle("on", bit === 1);
    bitEl.textContent = bit ? "1" : "0";
    frameEl.textContent = `HELLO #${seq}  ${index + 1}/${symbols.length}`;
    index += 1;
    if (index >= symbols.length) {
      seq = (seq + 1) & 0xff;
      if (!seq) seq = 1;
      symbols = pack(seq);
      index = 0;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.body.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});

if (navigator.wakeLock?.request) {
  const arm = () => navigator.wakeLock.request("screen").catch(() => {});
  arm();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") arm();
  });
}
