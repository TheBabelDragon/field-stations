import { decodeDemoSymbols, decodeSymbols, encodeDemoFrame, encodeFrame, MESSAGE } from "./optical/frame.js";
import { STATE, nextState } from "./optical/sync.js";
import { TimeSeries, findBrightestCell, sampleRegion } from "./optical/sampler.js";
import { decodeTimed, recentStats } from "./optical/demodulator.js";
import { describeFrame, packObservation } from "./protocol/field-packet.js";
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

const series = new TimeSeries(8000);
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
let aim = { nx: 0.5, ny: 0.42 };
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
    g.gain.value = 0.05;
    o.start();
    o.stop(audioCtx.currentTime + 0.12);
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
  }, 2400);
}

function paintWave() {
  const w = wave.width;
  const h = wave.height;
  waveCtx.fillStyle = "#10101c";
  waveCtx.fillRect(0, 0, w, h);
  const samples = series.samples;
  if (samples.length < 2) return;
  const slice = samples.slice(-Math.min(samples.length, 180));
  waveCtx.beginPath();
  waveCtx.strokeStyle = "#7ee7ff";
  waveCtx.lineWidth = 1.5;
  slice.forEach((s, i) => {
    const x = (i / (slice.length - 1)) * w;
    const y = h - 2 - s.value * (h - 4);
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();
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
  overCtx.strokeRect(x - 22, y - 22, 44, 44);
  overCtx.beginPath();
  overCtx.arc(x, y, 5, 0, Math.PI * 2);
  overCtx.fillStyle = "#fff6d5";
  overCtx.fill();
}

function applyDecode(decoded, brightness, st) {
  const state = nextState({ brightness, variance: st.contrast || st.variance || 0, decoded });
  const contrast = st.contrast ?? 0;
  sigBar.style.width = `${Math.round(Math.max(0, Math.min(1, brightness)) * 100)}%`;
  conBar.style.width = `${Math.round(Math.max(0, Math.min(1, contrast / 0.6)) * 100)}%`;
  paintWave();
  diag.textContent = `${(brightness * 100).toFixed(0)}% luma · contrast ${(contrast * 100).toFixed(0)}% · ${cfg.symbolMs}ms`;

  if (contrast < 0.08 && mode === "camera") {
    setState("NO CONTRAST", "bad");
    syncLine.textContent = "Sync — fill reticle with the disc";
    return;
  }
  if (state === STATE.NO_SIGNAL) {
    setState(state, "dim");
    syncLine.textContent = "Sync —";
    return;
  }
  if (decoded?.preamble && decoded.rejected) {
    setState("SYNC FOUND", "search");
    syncLine.textContent = "Sync ✓ preamble";
    frameLine.textContent = `Frame ${decoded.rejected}`;
    eccLine.textContent = "waiting for full packet";
    return;
  }
  if (!decoded || decoded.rejected === "sync-not-found") {
    setState(STATE.SEARCHING, "search");
    syncLine.textContent = "Sync searching";
    frameLine.textContent = "Frame --";
    eccLine.textContent = "ECC --";
    return;
  }
  if (decoded.rejected) {
    setState(decoded.rejected === "crc-mismatch" ? STATE.FRAME_CORRUPT : STATE.FRAME_LOST, "bad");
    syncLine.textContent = "Sync ✓";
    frameLine.textContent = `Frame ${decoded.rejected}`;
    eccLine.textContent = "ECC --";
    return;
  }
  const frame = decoded.frame;
  const desc = describeFrame(frame);
  syncLine.textContent = `Sync ✓ ${frame.phy || "v0"}`;
  frameLine.textContent = `Frame ${desc.type} #${frame.sequence}`;
  eccLine.textContent = frame.recovered ? "ECC recovered" : frame.phy === "demo" ? "demo PHY CRC" : "ECC clean";
  setState(frame.phy === "demo" ? "LOOP CLOSED" : (frame.recovered ? STATE.FRAME_RECOVERED : STATE.FRAME_VALID), "ok");
  if (frame.sequence !== lastSeq) {
    lastSeq = frame.sequence;
    celebrate(desc);
    if (desc.observation) {
      log(`LOOP ${desc.station} tag ${desc.observation.tag_id} conf=${desc.observation.confidence.toFixed(2)}`);
    } else {
      log(`LOOP ${desc.station} ${desc.type} #${frame.sequence} ${desc.hello || desc.payload_hex.slice(0, 24)}`);
    }
  }
}

function sampleCanvasSource(source, sw, sh) {
  work.width = 320;
  work.height = Math.max(180, Math.round(320 * (sh / sw)));
  workCtx.drawImage(source, 0, 0, work.width, work.height);
  const image = workCtx.getImageData(0, 0, work.width, work.height);
  let spot;
  if (aim) {
    spot = {
      x: aim.nx * work.width,
      y: aim.ny * work.height,
      w: 36,
      h: 36,
      value: 0,
    };
  } else if (cfg.expectedLocation === "bright") {
    spot = findBrightestCell(image);
    spot.w = 28;
    spot.h = 28;
  } else {
    spot = { x: work.width / 2, y: work.height / 2, w: 36, h: 36, value: 0 };
  }
  const value = sampleRegion(image, spot.x, spot.y, spot.w || 36, spot.h || 36);
  spot.value = value;
  series.push(performance.now(), value);
  paintOverlay(spot);
  const st = recentStats(series);
  const decoded = decodeTimed(series, cfg.symbolMs, [decodeDemoSymbols, decodeSymbols]);
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
  modeLabel.textContent = "camera · aim at the transmitter disc";
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
  await video.play();
  log("camera open — tap the glowing disc");
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
  const frames = [];
  for (let seq = 1; seq <= 4; seq++) {
    const hello = encodeDemoFrame({
      stationId,
      sequence: seq,
      messageType: MESSAGE.STATION_HELLO,
      payload: new TextEncoder().encode("HI"),
    });
    const obs = encodeDemoFrame({
      stationId,
      sequence: seq + 100,
      messageType: MESSAGE.FIELD_OBSERVATION,
      payload: packObservation({
        tagId: "deadbeefcafe0001",
        stationId: "field-station-0",
        confidence: 0.91,
        rssi: 42,
        fieldEpoch: 1,
        timestampNs: 1000000000 + seq,
      }),
    });
    frames.push(...hello, ...Array(10).fill(0), ...obs, ...Array(14).fill(0));
  }
  return frames;
}

function startVirtual() {
  stopCamera();
  mode = "virtual";
  document.body.classList.add("virtual");
  modeLabel.textContent = "self test · same-tab loop (not the phone camera)";
  virtSymbols = buildVirtualSymbols();
  virtIndex = 0;
  virtLast = performance.now();
  series.samples.length = 0;
  log("self test: decoder reads its own LED. Use tx.html + CAMERA for the real loop.");
  const step = (now) => {
    if (mode !== "virtual") return;
    if (now - virtLast >= cfg.symbolMs) {
      if (now - virtLast > cfg.symbolMs * 3) virtLast = now;
      else virtLast += cfg.symbolMs;
      const bit = virtSymbols[virtIndex % virtSymbols.length];
      virtIndex += 1;
      virtLed.classList.toggle("on", bit === 1);
      series.push(now, bit ? 0.92 : 0.06);
      const st = recentStats(series);
      const decoded = decodeTimed(series, cfg.symbolMs, [decodeDemoSymbols, decodeSymbols]);
      applyDecode(decoded, bit ? 0.92 : 0.06, st);
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

overlay.style.pointerEvents = "auto";
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
