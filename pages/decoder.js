import { decodeSymbols, encodeFrame, MESSAGE } from "./optical/frame.js";
import { STATE, nextState } from "./optical/sync.js";
import { TimeSeries, findBrightestCell, sampleRegion } from "./optical/sampler.js";
import { decodeTimed } from "./optical/demodulator.js";
import { describeFrame, packObservation } from "./protocol/field-packet.js";
import { parseBootstrap } from "./station/station-config.js";

const cfg = parseBootstrap();
const stationLabel = document.getElementById("station-label");
const listenState = document.getElementById("listen-state");
const sigBar = document.getElementById("sig-bar");
const syncLine = document.getElementById("sync-line");
const frameLine = document.getElementById("frame-line");
const eccLine = document.getElementById("ecc-line");
const diag = document.getElementById("diag");
const logEl = document.getElementById("log");
const video = document.getElementById("stage");
const overlay = document.getElementById("overlay");
const virtLed = document.getElementById("virtual-led");
const modeLabel = document.getElementById("mode-label");

stationLabel.textContent = cfg.stationParam && cfg.stationParam !== "0000"
  ? cfg.stationParam.toUpperCase()
  : "----";

const series = new TimeSeries(14000);
const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });
const overCtx = overlay.getContext("2d");

let mode = "idle";
let stream = null;
let raf = 0;
let lastSeq = -1;
let virtSymbols = [];
let virtIndex = 0;
let virtTimer = 0;

function log(line) {
  const t = new Date().toISOString().slice(11, 23);
  logEl.textContent = `[${t}] ${line}\n` + logEl.textContent;
}

function setState(name, cls) {
  listenState.textContent = name;
  listenState.className = "status " + (cls || "search");
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
  overCtx.strokeStyle = "rgba(126,231,255,0.9)";
  overCtx.lineWidth = 2;
  overCtx.strokeRect(x - 18, y - 18, 36, 36);
  overCtx.beginPath();
  overCtx.arc(x, y, 4, 0, Math.PI * 2);
  overCtx.fillStyle = "#fff6d5";
  overCtx.fill();
}

function applyDecode(decoded, brightness, variance) {
  const state = nextState({ brightness, variance, decoded });
  const signal = Math.max(0, Math.min(1, (brightness - 0.05) / 0.7 + variance * 8));
  sigBar.style.width = `${Math.round(signal * 100)}%`;
  diag.textContent = `${(brightness * 100).toFixed(0)}% luma · var ${variance.toFixed(4)} · ${cfg.symbolMs}ms`;

  if (state === STATE.NO_SIGNAL) {
    setState(state, "dim");
    syncLine.textContent = "Sync —";
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
  syncLine.textContent = "Sync ✓";
  frameLine.textContent = `Frame ${desc.type} #${frame.sequence}`;
  eccLine.textContent = frame.recovered ? "ECC recovered" : "ECC clean";
  setState(frame.recovered ? STATE.FRAME_RECOVERED : STATE.FRAME_VALID, "ok");
  if (frame.sequence !== lastSeq) {
    lastSeq = frame.sequence;
    if (desc.observation) {
      log(`${desc.station} saw ${desc.observation.tag_id}  conf=${desc.observation.confidence.toFixed(2)}`);
    } else {
      log(`${desc.station} ${desc.type} #${frame.sequence} ${desc.hello || desc.payload_hex.slice(0, 24)}`);
    }
  }
}

function sampleCanvasSource(source, sw, sh) {
  work.width = 320;
  work.height = Math.max(180, Math.round(320 * (sh / sw)));
  workCtx.drawImage(source, 0, 0, work.width, work.height);
  const image = workCtx.getImageData(0, 0, work.width, work.height);
  const spot = cfg.expectedLocation === "center"
    ? { x: work.width / 2, y: work.height / 2, w: 28, h: 28, value: 0 }
    : findBrightestCell(image);
  if (cfg.expectedLocation !== "center") {
    spot.w = 28;
    spot.h = 28;
  }
  const value = sampleRegion(image, spot.x, spot.y, spot.w || 28, spot.h || 28);
  spot.value = value;
  series.push(performance.now(), value);
  paintOverlay(spot);
  const st = series.stats();
  const decoded = decodeTimed(series, cfg.symbolMs, decodeSymbols);
  applyDecode(decoded, value, st.variance);
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
  modeLabel.textContent = "camera · live LED channel";
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  log("camera open");
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
    const hello = encodeFrame({
      stationId,
      sequence: seq,
      messageType: MESSAGE.STATION_HELLO,
      payload: new TextEncoder().encode(`HELLO-${seq}`),
    });
    const obs = encodeFrame({
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
    frames.push(...hello, ...Array(12).fill(0), ...obs, ...Array(16).fill(0));
  }
  return frames;
}

function startVirtual() {
  stopCamera();
  mode = "virtual";
  document.body.classList.add("virtual");
  modeLabel.textContent = "virtual LED · phase 1 fake station";
  virtSymbols = buildVirtualSymbols();
  virtIndex = 0;
  series.samples.length = 0;
  log("virtual LED repeating HELLO + observation");
  const tick = () => {
    if (mode !== "virtual") return;
    const bit = virtSymbols[virtIndex % virtSymbols.length];
    virtIndex += 1;
    virtLed.classList.toggle("on", bit === 1);
    const t = performance.now();
    series.push(t, bit ? 0.92 : 0.06);
    const st = series.stats();
    const decoded = decodeTimed(series, cfg.symbolMs, decodeSymbols);
    applyDecode(decoded, bit ? 0.92 : 0.06, st.variance);
    virtTimer = setTimeout(tick, cfg.symbolMs);
  };
  tick();
}

function stopVirtual() {
  if (virtTimer) clearTimeout(virtTimer);
  virtTimer = 0;
  virtLed.classList.remove("on");
}

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
});

if (location.hash === "#virtual" || new URLSearchParams(location.search).get("demo") === "1") {
  startVirtual();
}
