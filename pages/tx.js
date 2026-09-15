import { encodeLiteFrame } from "./optical/lite.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationId = cfg.stationId || 0x7f29;
const framesPerSymbol = Math.max(3, Number(new URLSearchParams(location.search).get("frames") || 4));
const symbolMs = Math.round(framesPerSymbol * (1000 / 60));

document.getElementById("station-label").textContent = stationId.toString(16).toUpperCase().padStart(4, "0");

const led = document.getElementById("tx-led");
const bitEl = document.getElementById("tx-bit");
const frameEl = document.getElementById("tx-frame");
const meta = document.getElementById("tx-meta");
const seqEl = document.getElementById("tx-seq");

function pack(seq) {
  return [...encodeLiteFrame({ sequence: seq }), 0, 0, 0, 0];
}

let seq = 1;
let symbols = pack(seq);
let index = 0;
let frameCount = 0;
let bit = 0;

meta.textContent = `${framesPerSymbol} frames/symbol · ~${symbolMs}ms · vsync · tap fullscreen`;

function applyBit() {
  bit = symbols[index];
  led.classList.toggle("on", bit === 1);
  bitEl.textContent = bit ? "1" : "0";
  if (seqEl) seqEl.textContent = String(seq);
  frameEl.textContent = `SEQ ${seq}  ${index + 1}/${symbols.length}`;
}

applyBit();

function tick() {
  frameCount += 1;
  if (frameCount % framesPerSymbol === 0) {
    index += 1;
    if (index >= symbols.length) {
      seq = seq >= 99 ? 1 : seq + 1;
      symbols = pack(seq);
      index = 0;
    }
    applyBit();
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
