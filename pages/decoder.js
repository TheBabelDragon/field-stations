import { TimeSeries, sampleRegion } from "./optical/sampler.js";
import { recentStats } from "./optical/demodulator.js";
import { cellGrid, scoreCells, estimateClockMs, sliceFrom, correlateStart } from "./optical/detect.js";
import { CLOCK_TRAIN, decodeBits } from "./optical/phy.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
document.getElementById("station-label").textContent = cfg.stationParam;

const listenState = document.getElementById("listen-state");
const sigBar = document.getElementById("sig-bar");
const conBar = document.getElementById("con-bar");
const rawLine = document.getElementById("raw-line");
const syncLine = document.getElementById("sync-line");
const frameLine = document.getElementById("frame-line");
const diag = document.getElementById("diag");
const logEl = document.getElementById("log");
const recBody = document.getElementById("rec-body");
const video = document.getElementById("stage");
const overlay = document.getElementById("overlay");
const modeLabel = document.getElementById("mode-label");
const wave = document.getElementById("wave");
const waveCtx = wave.getContext("2d");
const banner = document.getElementById("loop-banner");
const unlockBtn = document.getElementById("unlock");
const lockNote = document.getElementById("lock-note");

const series = new TimeSeries(8000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");
const history = [];

let mode = "AUTO";
let running = false;
let aim = { nx: 0.5, ny: 0.5 };
let lastPayload = null;
let audioCtx = null;

function log(line) {
  logEl.textContent = `[${new Date().toISOString().slice(11, 23)}] ${line}\n` + logEl.textContent;
}

function setState(name, cls) {
  listenState.textContent = name;
  listenState.className = "status " + (cls || "search");
  document.body.classList.toggle("locked", mode === "LOCKED");
}

function setMode(next) {
  mode = next;
  unlockBtn.textContent = mode === "LOCKED" ? "UNLOCK" : "AUTO";
  lockNote.textContent = mode;
  modeLabel.textContent = mode === "LOCKED"
    ? `LOCKED  ${(aim.nx * 100).toFixed(0)},${(aim.ny * 100).toFixed(0)}`
    : "AUTO — searching for a blinking disc";
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
    o.stop(audioCtx.currentTime + 0.12);
  } catch { /* ignore */ }
  navigator.vibrate?.([30, 40, 70]);
}

function paintWave(ok) {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const slice = series.samples.slice(-160);
  if (slice.length < 2) return;
  waveCtx.beginPath();
  waveCtx.strokeStyle = ok ? "#7dffb2" : "#7ee7ff";
  waveCtx.lineWidth = 1.5;
  slice.forEach((s, i) => {
    const x = (i / (slice.length - 1)) * w;
    const y = h - 2 - s.value * (h - 4);
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();
}

function paintOverlay(spot, ok) {
  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
  overCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!spot) return;
  const x = spot.x * overlay.width / work.width;
  const y = spot.y * overlay.height / work.height;
  overCtx.strokeStyle = mode === "LOCKED" ? "rgba(125,255,178,0.95)" : ok ? "rgba(255,211,126,0.95)" : "rgba(126,231,255,0.8)";
  overCtx.lineWidth = mode === "LOCKED" ? 3 : 2;
  overCtx.strokeRect(x - 26, y - 26, 52, 52);
}

function apply(decoded, bits, period, brightness, contrast, signal) {
  rawLine.textContent = `RAW ${(bits.join("") || "—").slice(-32)}`;
  syncLine.textContent = period ? `Clock ${Math.round(period)}ms` : "Clock —";
  sigBar.style.width = `${Math.round(Math.max(0, Math.min(1, brightness)) * 100)}%`;
  conBar.style.width = `${Math.round(Math.max(0, Math.min(1, contrast / 0.45)) * 100)}%`;
  diag.textContent = `${mode}  con ${(contrast * 100).toFixed(0)}%  sig ${(signal * 100).toFixed(0)}%`;
  const ok = decoded && decoded.rejected == null;
  paintWave(ok);

  if (contrast < 0.08 && mode === "AUTO") {
    setState("AUTO — SEARCHING", "search");
    frameLine.textContent = "Payload —";
    return;
  }

  if (ok) {
    const hex = decoded.payload.toString(16).toUpperCase().padStart(2, "0");
    const st = decoded.stationId != null
      ? decoded.stationId.toString(16).toUpperCase().padStart(4, "0")
      : "----";
    setState(mode === "LOCKED" ? "LOCKED · RECEIVED" : "SIGNAL FOUND", "ok");
    frameLine.textContent = `PAYLOAD ${hex}`;
    recBody.textContent = [
      `STATION  ${st}`,
      decoded.sequence != null ? `SEQ      ${decoded.sequence}` : null,
      `PAYLOAD  ${hex}`,
      `CLOCK    ${Math.round(period)}ms`,
      `MODE     ${mode}`,
    ].filter(Boolean).join("\n");
    if (hex !== lastPayload) {
      lastPayload = hex;
      banner.hidden = false;
      banner.textContent = `RECEIVED ${hex}`;
      pulse();
      log(`RX ${st} payload ${hex}`);
      clearTimeout(apply._t);
      apply._t = setTimeout(() => {
        banner.hidden = true;
      }, 1600);
    }
    return;
  }

  if (decoded?.preamble || decoded?.clock?.i >= 0) {
    setState(mode === "LOCKED" ? "LOCKED · CLOCK" : "SIGNAL FOUND", "search");
    frameLine.textContent = decoded.rejected || "sync";
    return;
  }

  setState(mode === "LOCKED" ? "LOCKED" : "AUTO — SEARCHING", mode === "LOCKED" ? "ok" : "search");
  frameLine.textContent = decoded?.rejected || "listening";
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
    workCtx.drawImage(video, (work.width - sw * scale) / 2, (work.height - sh * scale) / 2, sw * scale, sh * scale);
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    const grid = cellGrid(image);
    history.push(grid);
    if (history.length > 18) history.shift();
    const cand = scoreCells(history);
    if (mode === "AUTO" && cand) {
      aim.nx = aim.nx * 0.7 + cand.nx * 0.3;
      aim.ny = aim.ny * 0.7 + cand.ny * 0.3;
    }
    const spot = { x: aim.nx * work.width, y: aim.ny * work.height, w: 40, h: 40 };
    const value = sampleRegion(image, spot.x, spot.y, 40, 40);
    series.push(performance.now(), value);
    const st = recentStats(series);
    const period = estimateClockMs(series.samples) || cfg.symbolMs;
    const hit = correlateStart(series.samples, period, CLOCK_TRAIN);
    let bits = [];
    let decoded = { rejected: "no-clock" };
    if (hit.score >= 0.28) {
      bits = sliceFrom(series.samples, hit.t, period, 64);
      decoded = decodeBits(bits, cfg.stage);
    } else {
      bits = sliceFrom(series.samples, series.samples[0]?.t || 0, period, 32);
    }
    paintOverlay(spot, hit.score >= 0.28);
    apply(decoded, bits, period, value, st.contrast, cand?.score || 0);
  }
  requestAnimationFrame(sampleFrame);
}

async function startCamera() {
  running = true;
  setMode("AUTO");
  const stream = await navigator.mediaDevices.getUserMedia({
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
  setMode("LOCKED");
  log(`LOCKED ${(aim.nx * 100).toFixed(0)},${(aim.ny * 100).toFixed(0)}`);
});

unlockBtn.addEventListener("click", () => {
  setMode("AUTO");
  log("AUTO");
});

document.getElementById("cam").addEventListener("click", () => {
  startCamera().catch((err) => {
    setState("CAMERA DENIED", "bad");
    log(String(err.message || err));
  });
});

document.getElementById("clear").addEventListener("click", () => {
  series.samples.length = 0;
  lastPayload = null;
  logEl.textContent = "";
  recBody.textContent = "none yet";
  banner.hidden = true;
});
