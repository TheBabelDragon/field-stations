import { encodeDemoFrame, MESSAGE } from "./optical/frame.js";
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

const series = new TimeSeries(12000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");

let mode = "idle";
let stream = null;
let raf = 0;
let lastSeq = -1;
let virtSymbols = [];
let virtIndex = 0;
let virtLast = 0;
let aim = { nx: 0.5, ny: 0.5 };
let audioCtx = null;

function log(line) {
  const t = new Date().toISOString().slice(11, 23);
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent;
}

function setState(name, cls) {
  listenState.textContent = name;
  listenState.className = "status " + (cls || "search");
}

function beep(freq = 880) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.value = 0.06;
    o.start();
    o.stop(audioCtx.currentTime + 0.14);
  } catch {
    /* ignore */
  }
}

function celebrate(desc) {
  banner.hidden = false;
  banner.textContent = `LOOP CLOSED · ${desc.type} #${desc.sequence}`;
  beep(desc.type === "FIELD_OBSERVATION" ? 1174 : 880);
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => {
    banner.hidden = true;
  }, 2800);
}

function paintWave(score) {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const slice = series.samples.slice(-180);
  if (slice.length > 1) {
    waveCtx.beginPath();
    waveCtx.strokeStyle = score >= 0.32 ? "#7dffb2" : "#7ee7ff";
    waveCtx.lineWidth = 1.5;
    slice.forEach((s, i) => {
      const x = (i / (slice.length - 1)) * w;
      const y = h - 2 - s.value * (h - 4);
      if (i === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    });
    waveCtx.stroke();
  }
}

function paintOverlay(spot) {
  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
  overCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!spot) return;
  const sx = overlay.width / work.width;
  const sy = overlay.height / work.height;
  const x = spot.x * sx;
  const y = spot.y * sy;
  overCtx.strokeStyle = "rgba(126,231,255,0.95)";
  overCtx.lineWidth = 2;
  overCtx.strokeRect(x - 26, y - 26, 52, 52);
  overCtx.beginPath();
  overCtx.arc(x, y, 6, 0, Math.PI * 2);
  overCtx.fillStyle = "#fff6d5";
  overCtx.fill();
}

function applyDecode(decoded, brightness, st) {
  const contrast = st.contrast ?? 0;
  const score = decoded.score || 0;
  sigBar.style.width = `${Math.round(Math.max(0, Math.min(1, brightness)) * 100)}%`;
  conBar.style.width = `${Math.round(Math.max(0, Math.min(1, contrast / 0.45)) * 100)}%`;
  paintWave(score);
  diag.textContent = `${(brightness * 100).toFixed(0)}% luma  contrast ${(contrast * 100).toFixed(0)}%  corr ${score.toFixed(2)}  ${cfg.symbolMs}ms`;

  if (mode === "camera" && contrast < 0.1) {
    setState("NO CONTRAST", "bad");
    syncLine.textContent = "Sync — tap the disc, fill the box";
    return;
  }
  if (decoded.frame) {
    const frame = decoded.frame;
    const desc = describeFrame(frame);
    setState("LOOP CLOSED", "ok");
    syncLine.textContent = `Sync ✓ corr ${score.toFixed(2)}`;
    frameLine.textContent = `Frame ${desc.type} #${frame.sequence}`;
    eccLine.textContent = frame.phy === "demo" ? "demo CRC ok" : "v0 ok";
    if (frame.sequence !== lastSeq) {
      lastSeq = frame.sequence;
      celebrate(desc);
      log(`LOOP ${desc.station} ${desc.type} #${frame.sequence} ${desc.hello || ""}`);
    }
    return;
  }
  if (decoded.preamble || score >= 0.32) {
    setState("SYNC FOUND", "ok");
    syncLine.textContent = `Sync ✓ corr ${score.toFixed(2)}`;
    frameLine.textContent = `Frame ${decoded.bitsHave || 0}/${decoded.bitsNeed || 88} ${decoded.rejected || "collecting"}`;
    eccLine.textContent = "hold still";
    return;
  }
  if (contrast >= 0.1) {
    setState(STATE.SEARCHING, "search");
    syncLine.textContent = `Sync searching  corr ${score.toFixed(2)}`;
    frameLine.textContent = "Frame --";
    eccLine.textContent = "ECC --";
    return;
  }
  setState(STATE.NO_SIGNAL, "dim");
  syncLine.textContent = "Sync —";
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
  const spot = {
    x: aim.nx * work.width,
    y: aim.ny * work.height,
    w: 44,
    h: 44,
    value: 0,
  };
  const value = sampleRegion(image, spot.x, spot.y, spot.w, spot.h);
  spot.value = value;
  series.push(performance.now(), value);
  paintOverlay(spot);
  const st = recentStats(series);
  const decoded = decodeFromSeries(series, cfg.symbolMs);
  applyDecode(decoded, value, st);
}

function cameraLoop() {
  if (mode !== "camera") return;
  if (video.readyState >= 2) {
    sampleCanvasSource(video, video.videoWidth || 640, video.videoHeight || 360);
  }
  raf = requestAnimationFrame(cameraLoop);
}

async function startCamera() {
  stopVirtual();
  mode = "camera";
  document.body.classList.remove("virtual");
  modeLabel.textContent = `camera · ${cfg.symbolMs}ms · tap the disc`;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();
  log("camera open — tap the glowing disc and hold still ~15s");
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

function buildVirtualSymbols() {
  const stationId = cfg.stationId || 0x7f29;
  const out = [];
  for (let seq = 1; seq <= 6; seq++) {
    out.push(
      ...encodeDemoFrame({
        stationId,
        sequence: seq,
        messageType: MESSAGE.STATION_HELLO,
        payload: new TextEncoder().encode("HI"),
      }),
      ...Array(8).fill(0),
    );
  }
  return out;
}

function startVirtual() {
  stopCamera();
  mode = "virtual";
  document.body.classList.add("virtual");
  modeLabel.textContent = "self test · not the phone camera";
  virtSymbols = buildVirtualSymbols();
  virtIndex = 0;
  virtLast = performance.now();
  series.samples.length = 0;
  log("self test reads its own disc. Real loop = tx.html + CAMERA.");
  const step = (now) => {
    if (mode !== "virtual") return;
    if (now - virtLast >= cfg.symbolMs) {
      if (now - virtLast > cfg.symbolMs * 4) virtLast = now;
      else virtLast += cfg.symbolMs;
      const bit = virtSymbols[virtIndex % virtSymbols.length];
      virtIndex += 1;
      virtLed.classList.toggle("on", bit === 1);
      series.push(now, bit ? 0.95 : 0.04);
      const st = recentStats(series);
      applyDecode(decodeFromSeries(series, cfg.symbolMs), bit ? 0.95 : 0.04, st);
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function stopVirtual() {
  virtLed.classList.remove("on");
}

function setAimFromEvent(ev) {
  const r = overlay.getBoundingClientRect();
  const x = ev.clientX ?? ev.touches?.[0]?.clientX;
  const y = ev.clientY ?? ev.touches?.[0]?.clientY;
  if (x == null) return;
  aim = {
    nx: Math.min(1, Math.max(0, (x - r.left) / r.width)),
    ny: Math.min(1, Math.max(0, (y - r.top) / r.height)),
  };
  log(`aim ${(aim.nx * 100).toFixed(0)},${(aim.ny * 100).toFixed(0)}`);
}

overlay.addEventListener("pointerdown", setAimFromEvent);

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
  banner.hidden = true;
});

if (location.hash === "#virtual" || new URLSearchParams(location.search).get("demo") === "1") {
  startVirtual();
}
