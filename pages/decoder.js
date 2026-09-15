import { encodeLiteFrame } from "./optical/lite.js";
import { STATE } from "./optical/sync.js";
import { TimeSeries, sampleRegion } from "./optical/sampler.js";
import { decodeFromSeries, recentStats } from "./optical/demodulator.js";
import { describeFrame } from "./protocol/field-packet.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationLabel = document.getElementById("station-label");
const listenState = document.getElementById("listen-state");
const sigBar = document.getElementById("sig-bar");
const conBar = document.getElementById("con-bar");
const syncLine = document.getElementById("sync-line");
const frameLine = document.getElementById("frame-line");
const eccLine = document.getElementById("ecc-line");
const diag = document.getElementById("diag");
const logEl = document.getElementById("log");
const recBody = document.getElementById("rec-body");
const video = document.getElementById("stage");
const overlay = document.getElementById("overlay");
const virtLed = document.getElementById("virtual-led");
const modeLabel = document.getElementById("mode-label");
const wave = document.getElementById("wave");
const waveCtx = wave.getContext("2d");
const banner = document.getElementById("loop-banner");

stationLabel.textContent = cfg.stationParam && cfg.stationParam !== "0000"
  ? cfg.stationParam.toUpperCase()
  : "----";

const series = new TimeSeries(8000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");

const COLS = 16;
const ROWS = 10;
const grids = [];

let mode = "idle";
let stream = null;
let raf = 0;
let lastSeq = -1;
let virtSymbols = [];
let virtIndex = 0;
let virtLast = 0;
let aim = { nx: 0.5, ny: 0.5 };
let tapUntil = 0;
let audioCtx = null;

function log(line) {
  const t = new Date().toISOString().slice(11, 23);
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent;
}

function setState(name, cls) {
  listenState.textContent = name;
  listenState.className = "status " + (cls || "search");
  document.body.classList.toggle("locked", cls === "ok");
}

function pulse(freq) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.value = 0.07;
    o.start();
    o.stop(audioCtx.currentTime + 0.14);
  } catch { /* ignore */ }
  navigator.vibrate?.([40, 40, 90]);
}

function showRecovered(desc, frame) {
  const hello = desc.hello || new TextDecoder().decode(frame.payload || new Uint8Array());
  recBody.textContent = [
    `station  ${desc.station}`,
    `seq      ${frame.sequence}`,
    `type     ${desc.type}`,
    `msg      ${hello || desc.payload_hex.slice(0, 16)}`,
    `phy      ${frame.phy}`,
    `crc      ok`,
  ].join("\n");
  banner.hidden = false;
  banner.textContent = `RECOVERED · ${desc.station} #${frame.sequence} · ${hello || desc.type}`;
  pulse(1174);
  clearTimeout(showRecovered._t);
  showRecovered._t = setTimeout(() => {
    banner.hidden = true;
  }, 2200);
}

function paintWave(score, recovered) {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const slice = series.samples.slice(-160);
  if (slice.length < 2) return;
  waveCtx.beginPath();
  waveCtx.strokeStyle = recovered ? "#7dffb2" : score >= 0.28 ? "#ffd37e" : "#7ee7ff";
  waveCtx.lineWidth = 1.5;
  slice.forEach((s, i) => {
    const x = (i / (slice.length - 1)) * w;
    const y = h - 2 - s.value * (h - 4);
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();
}

function paintOverlay(spot, recovered) {
  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
  overCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!spot) return;
  const x = spot.x * overlay.width / work.width;
  const y = spot.y * overlay.height / work.height;
  overCtx.strokeStyle = recovered ? "rgba(125,255,178,0.95)" : "rgba(126,231,255,0.85)";
  overCtx.lineWidth = recovered ? 3 : 2;
  overCtx.strokeRect(x - 28, y - 28, 56, 56);
}

function gridFromImage(image) {
  const g = new Float32Array(COLS * ROWS);
  const cw = image.width / COLS;
  const ch = image.height / ROWS;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      g[r * COLS + c] = sampleRegion(image, (c + 0.5) * cw, (r + 0.5) * ch, cw * 0.9, ch * 0.9);
    }
  }
  return g;
}

function blinkCell() {
  if (grids.length < 10) return null;
  let bestI = 0;
  let bestV = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    let min = 1;
    let max = 0;
    for (const g of grids) {
      const v = g[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min;
    if (span > bestV) {
      bestV = span;
      bestI = i;
    }
  }
  if (bestV < 0.1) return null;
  return {
    nx: ((bestI % COLS) + 0.5) / COLS,
    ny: (Math.floor(bestI / COLS) + 0.5) / ROWS,
    contrast: bestV,
  };
}

function applyDecode(decoded, brightness, st) {
  const contrast = st.contrast ?? 0;
  const score = decoded.score || 0;
  const recovered = !!(decoded.frame && decoded.rejected == null);

  sigBar.style.width = `${Math.round(Math.max(0, Math.min(1, brightness)) * 100)}%`;
  conBar.style.width = `${Math.round(Math.max(0, Math.min(1, contrast / 0.4)) * 100)}%`;
  paintWave(score, recovered);
  diag.textContent = `${(brightness * 100).toFixed(0)}%  con ${(contrast * 100).toFixed(0)}%  corr ${score.toFixed(2)}  ${Math.round(decoded.symbolMs || cfg.symbolMs)}ms`;

  if (recovered) {
    const desc = describeFrame(decoded.frame);
    setState("RECOVERED", "ok");
    syncLine.textContent = `Authenticated  corr ${score.toFixed(2)}`;
    frameLine.textContent = `${desc.type} #${decoded.frame.sequence}`;
    eccLine.textContent = `${decoded.frame.phy} CRC ok`;
    if (decoded.frame.sequence !== lastSeq) {
      lastSeq = decoded.frame.sequence;
      showRecovered(desc, decoded.frame);
      log(`RECOVERED ${desc.station} ${desc.type} #${decoded.frame.sequence} ${desc.hello || ""}`);
    }
    return;
  }

  if (decoded.preamble || score >= 0.28) {
    setState("PREAMBLE CANDIDATE", "search");
    syncLine.textContent = `Candidate only  corr ${score.toFixed(2)}`;
    frameLine.textContent = `${decoded.bitsHave || 0}/${decoded.bitsNeed || 32}  ${decoded.rejected || "collecting"}`;
    eccLine.textContent = "CRC not ok yet";
    return;
  }

  if (mode === "camera" && contrast < 0.08) {
    setState("NO CONTRAST", "bad");
    syncLine.textContent = "Aim at the disc";
    return;
  }
  if (contrast >= 0.08) {
    setState(STATE.SEARCHING, "search");
    syncLine.textContent = `Searching  corr ${score.toFixed(2)}`;
    frameLine.textContent = "Frame --";
    eccLine.textContent = "CRC --";
    return;
  }
  setState(STATE.NO_SIGNAL, "dim");
  syncLine.textContent = "No candidate";
}

function sampleCanvasSource(source, sw, sh) {
  const ow = overlay.clientWidth || 320;
  const oh = overlay.clientHeight || 180;
  work.width = 320;
  work.height = Math.max(160, Math.round(320 * (oh / ow)));
  workCtx.fillStyle = "#000";
  workCtx.fillRect(0, 0, work.width, work.height);
  const scale = Math.min(work.width / sw, work.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (work.width - dw) / 2;
  const dy = (work.height - dh) / 2;
  workCtx.drawImage(source, dx, dy, dw, dh);
  const image = workCtx.getImageData(0, 0, work.width, work.height);

  if (mode === "camera") {
    grids.push(gridFromImage(image));
    if (grids.length > 18) grids.shift();
    const blink = blinkCell();
    if (blink && performance.now() > tapUntil) {
      aim.nx = aim.nx * 0.65 + blink.nx * 0.35;
      aim.ny = aim.ny * 0.65 + blink.ny * 0.35;
    }
  }

  const spot = { x: aim.nx * work.width, y: aim.ny * work.height, w: 48, h: 48, value: 0 };
  const value = sampleRegion(image, spot.x, spot.y, spot.w, spot.h);
  series.push(performance.now(), value);
  const st = recentStats(series);
  const decoded = decodeFromSeries(series, cfg.symbolMs);
  paintOverlay(spot, !!(decoded.frame && decoded.rejected == null));
  applyDecode(decoded, value, st);
}

function cameraLoop() {
  if (mode !== "camera") return;
  if (video.readyState >= 2) sampleCanvasSource(video, video.videoWidth || 640, video.videoHeight || 360);
  raf = requestAnimationFrame(cameraLoop);
}

async function startCamera() {
  stopVirtual();
  mode = "camera";
  document.body.classList.remove("virtual");
  modeLabel.textContent = `camera · ${cfg.symbolMs}ms/symbol · CRC is the lock`;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
    },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();
  log("camera open — recovered means CRC matched");
  cameraLoop();
}

function stopCamera() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;
}

function startVirtual() {
  stopCamera();
  mode = "virtual";
  document.body.classList.add("virtual");
  modeLabel.textContent = "self test · same tab";
  virtSymbols = [];
  for (let seq = 1; seq <= 8; seq++) {
    virtSymbols.push(...encodeLiteFrame({ stationId: cfg.stationId || 0x7f29, sequence: seq }), ...Array(6).fill(0));
  }
  virtIndex = 0;
  virtLast = performance.now();
  series.samples.length = 0;
  log("self test should print RECOVERED + HI");
  const step = (now) => {
    if (mode !== "virtual") return;
    if (now - virtLast >= cfg.symbolMs) {
      if (now - virtLast > cfg.symbolMs * 4) virtLast = now;
      else virtLast += cfg.symbolMs;
      const bit = virtSymbols[virtIndex % virtSymbols.length];
      virtIndex += 1;
      virtLed.classList.toggle("on", bit === 1);
      series.push(now, bit ? 0.95 : 0.04);
      applyDecode(decodeFromSeries(series, cfg.symbolMs), bit ? 0.95 : 0.04, recentStats(series));
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function stopVirtual() {
  virtLed.classList.remove("on");
}

overlay.addEventListener("pointerdown", (ev) => {
  const r = overlay.getBoundingClientRect();
  aim = {
    nx: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
    ny: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
  };
  tapUntil = performance.now() + 2500;
});

document.getElementById("cam").addEventListener("click", () => {
  startCamera().catch((err) => {
    setState("CAMERA DENIED", "bad");
    log(String(err.message || err));
  });
});
document.getElementById("virt").addEventListener("click", startVirtual);
document.getElementById("clear").addEventListener("click", () => {
  series.samples.length = 0;
  lastSeq = -1;
  logEl.textContent = "";
  if (recBody) recBody.textContent = "none yet — candidate is not a message";
  banner.hidden = true;
});

if (location.hash === "#virtual" || new URLSearchParams(location.search).get("demo") === "1") {
  startVirtual();
}
