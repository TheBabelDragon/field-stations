import { TimeSeries, sampleRegion, findBrightestCell } from "./optical/sampler.js";
import { recentStats } from "./optical/demodulator.js";
import { decodeStage, estimateSymbolMs, sliceRaw, byteBits } from "./optical/phy.js";
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

const series = new TimeSeries(6000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");
const expectBits = byteBits(cfg.payload).join("");

let running = false;
let aim = { nx: 0.5, ny: 0.5 };
let tapUntil = 0;
let lastHit = "";
let audioCtx = null;

function log(line) {
  logEl.textContent = `[${new Date().toISOString().slice(11, 23)}] ${line}\n` + logEl.textContent;
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
    o.stop(audioCtx.currentTime + 0.12);
  } catch { /* ignore */ }
  navigator.vibrate?.([30, 40, 70]);
}

function paintWave(bitsOk) {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const slice = series.samples.slice(-160);
  if (slice.length < 2) return;
  waveCtx.beginPath();
  waveCtx.strokeStyle = bitsOk ? "#7dffb2" : "#7ee7ff";
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
  overCtx.strokeStyle = ok ? "rgba(125,255,178,0.95)" : "rgba(255,211,126,0.95)";
  overCtx.lineWidth = 2;
  const rw = (spot.w || 40) * overlay.width / work.width;
  const rh = (spot.h || 40) * overlay.height / work.height;
  overCtx.strokeRect(x - rw / 2, y - rh / 2, rw, rh);
}

function lockSpot(image) {
  const bright = findBrightestCell(image, 14, 0.1);
  if (performance.now() < tapUntil) {
    return {
      x: aim.nx * work.width,
      y: aim.ny * work.height,
      w: 44,
      h: 44,
      value: bright.value,
    };
  }
  aim.nx = aim.nx * 0.55 + (bright.x / work.width) * 0.45;
  aim.ny = aim.ny * 0.55 + (bright.y / work.height) * 0.45;
  return {
    x: aim.nx * work.width,
    y: aim.ny * work.height,
    w: Math.max(28, bright.w || 36),
    h: Math.max(28, bright.h || 36),
    value: bright.value,
  };
}

function apply(bits, period, brightness, contrast) {
  const raw = bits.join("");
  const shown = raw.slice(-24) || "—";
  rawLine.textContent = `RAW ${shown}`;
  syncLine.textContent = period ? `Clock ${Math.round(period)}ms` : "Clock measuring";
  sigBar.style.width = `${Math.round(Math.max(0, Math.min(1, brightness)) * 100)}%`;
  conBar.style.width = `${Math.round(Math.max(0, Math.min(1, contrast / 0.45)) * 100)}%`;
  diag.textContent = `${(brightness * 100).toFixed(0)}%  con ${(contrast * 100).toFixed(0)}%  stage ${cfg.stage}`;

  const decoded = decodeStage(cfg.stage, bits, { payload: cfg.payload, stationId: cfg.stationId });
  const ok = decoded.rejected == null;
  paintWave(ok);

  if (contrast < 0.1) {
    setState("NO CONTRAST", "bad");
    frameLine.textContent = "Symbol —";
    return;
  }

  if (ok) {
    const hex = (decoded.payload ?? cfg.payload).toString(16).toUpperCase().padStart(2, "0");
    setState("RAW MATCH", "ok");
    frameLine.textContent = `SYMBOL ${hex}`;
    recBody.textContent = [
      `STAGE    ${cfg.stage}`,
      `RAW      ${expectBits}`,
      `SYMBOL   ${hex}`,
      decoded.stationId != null ? `STATION  ${decoded.stationId.toString(16).toUpperCase().padStart(4, "0")}` : null,
      decoded.sequence != null ? `SEQ      ${decoded.sequence}` : null,
      `CLOCK    ${Math.round(period || cfg.symbolMs)}ms`,
    ].filter(Boolean).join("\n");
    if (hex !== lastHit) {
      lastHit = hex;
      banner.hidden = false;
      banner.textContent = `RAW ${expectBits}  SYM ${hex}`;
      pulse();
      log(`MATCH ${expectBits} = ${hex}`);
      clearTimeout(apply._t);
      apply._t = setTimeout(() => {
        banner.hidden = true;
      }, 1800);
    }
    return;
  }

  setState(decoded.preamble ? "PREAMBLE" : "LISTENING", "search");
  frameLine.textContent = decoded.rejected || "waiting for pattern";
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
    workCtx.drawImage(
      video,
      (work.width - sw * scale) / 2,
      (work.height - sh * scale) / 2,
      sw * scale,
      sh * scale,
    );
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    const spot = lockSpot(image);
    const value = sampleRegion(image, spot.x, spot.y, spot.w, spot.h);
    series.push(performance.now(), value);
    const st = recentStats(series);
    const period = estimateSymbolMs(series.samples) || cfg.symbolMs;
    const bits = sliceRaw(series.samples, period);
    paintOverlay(spot, bits.join("").includes(expectBits));
    apply(bits, period, value, st.contrast);
  }
  requestAnimationFrame(sampleFrame);
}

async function startCamera() {
  running = true;
  modeLabel.textContent = `stage ${cfg.stage} · want ${expectBits}`;
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
  log("camera open — tracking brightest region");
  sampleFrame();
}

overlay.addEventListener("pointerdown", (ev) => {
  const r = overlay.getBoundingClientRect();
  aim = {
    nx: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
    ny: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
  };
  tapUntil = performance.now() + 2000;
});

document.getElementById("cam").addEventListener("click", () => {
  startCamera().catch((err) => {
    setState("CAMERA DENIED", "bad");
    log(String(err.message || err));
  });
});

document.getElementById("clear").addEventListener("click", () => {
  series.samples.length = 0;
  lastHit = "";
  logEl.textContent = "";
  recBody.textContent = "none yet";
  banner.hidden = true;
});
