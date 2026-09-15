import { STATE } from "./optical/sync.js";
import { TimeSeries, sampleRegion } from "./optical/sampler.js";
import { decodeFromSeries, recentStats } from "./optical/demodulator.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationHex = (cfg.stationId || 0x7f29).toString(16).toUpperCase().padStart(4, "0");

document.getElementById("station-label").textContent = stationHex;

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
const modeLabel = document.getElementById("mode-label");
const wave = document.getElementById("wave");
const waveCtx = wave.getContext("2d");
const banner = document.getElementById("loop-banner");

const series = new TimeSeries(8000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");

const COLS = 16;
const ROWS = 10;
const grids = [];

let stream = null;
let raf = 0;
let lastSeq = -1;
let aim = { nx: 0.5, ny: 0.5 };
let tapUntil = 0;
let running = false;
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

function pulse() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 1174;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.value = 0.07;
    o.start();
    o.stop(audioCtx.currentTime + 0.14);
  } catch { /* ignore */ }
  navigator.vibrate?.([40, 40, 90]);
}

function showRecovered(sequence, agrees) {
  recBody.textContent = `station  ${stationHex}\nseq      ${sequence}\nvote     ${agrees}/8 bits unanimous\ncrc      2-of-3 match`;
  banner.hidden = false;
  banner.textContent = `RECOVERED SEQ ${sequence}`;
  pulse();
  clearTimeout(showRecovered._t);
  showRecovered._t = setTimeout(() => {
    banner.hidden = true;
  }, 2000);
}

function paintWave(score, recovered) {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const slice = series.samples.slice(-160);
  if (slice.length < 2) return;
  waveCtx.beginPath();
  waveCtx.strokeStyle = recovered ? "#7dffb2" : score >= 0.3 ? "#ffd37e" : "#7ee7ff";
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
    const sequence = decoded.frame.sequence;
    setState("RECOVERED", "ok");
    syncLine.textContent = `Authenticated  corr ${score.toFixed(2)}`;
    frameLine.textContent = `SEQ ${sequence}`;
    eccLine.textContent = `vote ${decoded.frame.agrees}/8`;
    if (sequence !== lastSeq) {
      lastSeq = sequence;
      showRecovered(sequence, decoded.frame.agrees);
      log(`RECOVERED station ${stationHex} seq ${sequence}`);
    }
    return;
  }

  if (decoded.preamble || score >= 0.3) {
    setState("PREAMBLE CANDIDATE", "search");
    syncLine.textContent = `Candidate only  corr ${score.toFixed(2)}`;
    frameLine.textContent = `${decoded.bitsHave || 0}/${decoded.bitsNeed || 24}  ${decoded.rejected || "collecting"}`;
    eccLine.textContent = "vote not settled";
    return;
  }

  if (contrast < 0.08) {
    setState("NO CONTRAST", "bad");
    syncLine.textContent = "Fill the box with the disc";
    return;
  }
  setState(STATE.SEARCHING, "search");
  syncLine.textContent = `Searching  corr ${score.toFixed(2)}`;
}

function sampleFrame() {
  if (!running) return;
  if (video.readyState >= 2) {
    const sw = video.videoWidth || 640;
    const sh = video.videoHeight || 360;
    const ow = overlay.clientWidth || 320;
    const oh = overlay.clientHeight || 180;
    work.width = 320;
    work.height = Math.max(160, Math.round(320 * (oh / ow)));
    workCtx.fillStyle = "#000";
    workCtx.fillRect(0, 0, work.width, work.height);
    const scale = Math.min(work.width / sw, work.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    workCtx.drawImage(video, (work.width - dw) / 2, (work.height - dh) / 2, dw, dh);
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    grids.push(gridFromImage(image));
    if (grids.length > 18) grids.shift();
    const blink = blinkCell();
    if (blink && performance.now() > tapUntil) {
      aim.nx = aim.nx * 0.65 + blink.nx * 0.35;
      aim.ny = aim.ny * 0.65 + blink.ny * 0.35;
    }
    const spot = { x: aim.nx * work.width, y: aim.ny * work.height };
    const value = sampleRegion(image, spot.x, spot.y, 48, 48);
    series.push(performance.now(), value);
    const st = recentStats(series);
    const decoded = decodeFromSeries(series, cfg.symbolMs);
    paintOverlay(spot, !!(decoded.frame && decoded.rejected == null));
    applyDecode(decoded, value, st);
  }
  raf = requestAnimationFrame(sampleFrame);
}

async function startCamera() {
  running = true;
  modeLabel.textContent = `camera · ${cfg.symbolMs}ms/symbol`;
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
  log("camera open");
  sampleFrame();
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

document.getElementById("clear").addEventListener("click", () => {
  series.samples.length = 0;
  lastSeq = -1;
  logEl.textContent = "";
  recBody.textContent = "none — point at the computer disc";
  banner.hidden = true;
});
