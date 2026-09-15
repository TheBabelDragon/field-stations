import { encodeStage, byteBits } from "./optical/phy.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const symbols = encodeStage(cfg.stage, {
  stationId: cfg.stationId,
  sequence: 1,
  payload: cfg.payload,
});

document.getElementById("station-label").textContent = cfg.stationParam;

const led = document.getElementById("tx-led");
const meta = document.getElementById("tx-meta");
const pktEl = document.getElementById("tx-packet");
const rawEl = document.getElementById("tx-raw");
const frameEl = document.getElementById("tx-frame");

const t0 = performance.now();
let index = 0;

meta.textContent = `stage ${cfg.stage} · ${cfg.symbolMs}ms/bit · elapsed clock · tap fullscreen`;
pktEl.textContent = `${cfg.stationParam}  SYM ${cfg.payloadHex}`;
rawEl.textContent = `TX ${byteBits(cfg.payload).join("")}  (${cfg.payloadHex})`;

function apply(i) {
  const bit = symbols[i];
  led.classList.toggle("on", bit === 1);
  frameEl.textContent = `bit ${i + 1}/${symbols.length} = ${bit}`;
}

apply(0);

function tick(now) {
  const i = Math.floor((now - t0) / cfg.symbolMs) % symbols.length;
  if (i !== index) {
    index = i;
    apply(i);
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
