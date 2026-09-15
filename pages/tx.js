import { encodePacket, TYPE, formatPacket } from "./optical/packet.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationId = cfg.stationId;
const payload = cfg.payload;
const framesPerSymbol = cfg.frames;
const repeats = Math.max(2, Number(new URLSearchParams(location.search).get("rep") || 3));

document.getElementById("station-label").textContent = cfg.stationParam;

const led = document.getElementById("tx-led");
const meta = document.getElementById("tx-meta");
const frameEl = document.getElementById("tx-frame");
const pktEl = document.getElementById("tx-packet");

function pack(seq) {
  return encodePacket({
    stationId,
    sequence: seq,
    type: TYPE.SYMBOL,
    payload,
  });
}

let seq = 1;
let copies = 0;
let symbols = pack(seq);
let index = 0;
let frameCount = 0;

function renderLabel() {
  const view = formatPacket({
    stationId,
    sequence: seq,
    type: TYPE.SYMBOL,
    typeName: "SYMBOL",
    payload,
  });
  pktEl.textContent = `${view.st} | ${view.seq} | ${view.sym} | ${view.typ}`;
  meta.textContent = `${framesPerSymbol} frames/bit · payload ${cfg.payloadHex} · ${repeats}x · tap fullscreen`;
  frameEl.textContent = `copy ${copies + 1}/${repeats}  bit ${index + 1}/${symbols.length}`;
}

function applyBit() {
  led.classList.toggle("on", symbols[index] === 1);
  renderLabel();
}

applyBit();

function tick() {
  frameCount += 1;
  if (frameCount % framesPerSymbol === 0) {
    index += 1;
    if (index >= symbols.length) {
      copies += 1;
      index = 0;
      if (copies >= repeats) {
        copies = 0;
        seq = seq >= 255 ? 1 : seq + 1;
        symbols = pack(seq);
      }
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
