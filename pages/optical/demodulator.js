/** Brightness timeline -> symbols. Candidate preamble is not a recovered message. */

import { PREAMBLE, decodeDemoSymbols, decodeSymbols } from "./frame.js";
import { decodeLiteSymbols, LITE_BODY_BITS } from "./lite.js";

export function waveformToSymbols(samples, samplesPerSymbol, threshold = null) {
  if (samplesPerSymbol < 1) throw new Error("samples-per-symbol");
  if (!samples.length) return [];
  if (threshold == null) {
    let min = samples[0];
    let max = samples[0];
    for (const s of samples) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
    threshold = (min + max) / 2;
  }
  const symbols = [];
  for (let i = 0; i <= samples.length - samplesPerSymbol; i += samplesPerSymbol) {
    let sum = 0;
    for (let j = 0; j < samplesPerSymbol; j++) sum += samples[i + j];
    symbols.push(sum / samplesPerSymbol >= threshold ? 1 : 0);
  }
  return symbols;
}

export function decodeWaveform(samples, samplesPerSymbol, decodeSymbolsFn, threshold = null) {
  let last = { frame: null, rejected: "sync-not-found" };
  for (let phase = 0; phase < samplesPerSymbol; phase++) {
    const sliced = waveformToSymbols(samples.slice(phase), samplesPerSymbol, threshold);
    const result = decodeSymbolsFn(sliced);
    if (result.frame) return result;
    last = result;
  }
  return last;
}

export function recentStats(series, windowMs = 1800) {
  const all = series.samples;
  if (!all.length) return { min: 0, max: 0, mean: 0, variance: 0, contrast: 0 };
  const t1 = all[all.length - 1].t;
  const cut = t1 - windowMs;
  let min = 1;
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.t < cut) break;
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    sum += s.value;
    n++;
  }
  if (!n) return { min: 0, max: 0, mean: 0, variance: 0, contrast: 0 };
  return { min, max, mean: sum / n, variance: 0, contrast: max - min };
}

export function resample(series, dt = 16) {
  const s = series.samples;
  if (s.length < 2) return [];
  const t1 = s[s.length - 1].t;
  const t0 = Math.max(s[0].t, t1 - 4000);
  const out = [];
  let i = 0;
  while (i + 1 < s.length && s[i + 1].t < t0) i++;
  for (let t = t0; t <= t1; t += dt) {
    while (i + 1 < s.length && s[i + 1].t < t) i++;
    const a = s[i];
    const b = s[Math.min(i + 1, s.length - 1)];
    const span = Math.max(1, b.t - a.t);
    const u = Math.min(1, Math.max(0, (t - a.t) / span));
    out.push({ t, v: a.value + (b.value - a.value) * u });
  }
  return out;
}

export function normalizeLocal(grid, win = 36) {
  return grid.map((p, idx) => {
    let min = 1;
    let max = 0;
    const a = Math.max(0, idx - win);
    const b = Math.min(grid.length, idx + win);
    for (let j = a; j < b; j++) {
      if (grid[j].v < min) min = grid[j].v;
      if (grid[j].v > max) max = grid[j].v;
    }
    const mid = (min + max) / 2;
    const amp = Math.max(0.05, (max - min) / 2);
    return { t: p.t, v: (p.v - mid) / amp };
  });
}

function scoreAt(norm, start, tmpl) {
  let s = 0;
  for (let j = 0; j < tmpl.length; j++) s += norm[start + j].v * tmpl[j];
  return s / tmpl.length;
}

export function correlatePattern(norm, symbolMs, pattern, dt) {
  const tmpl = [];
  const nPer = Math.max(2, Math.round(symbolMs / dt));
  for (const bit of pattern) {
    const val = bit ? 1 : -1;
    for (let i = 0; i < nPer; i++) tmpl.push(val);
  }
  let best = { score: -1, t: 0, index: -1, width: tmpl.length * dt, symbolMs };
  if (norm.length < tmpl.length) return best;
  const coarse = Math.max(1, Math.floor(nPer / 4));
  for (let i = 0; i <= norm.length - tmpl.length; i += coarse) {
    const score = scoreAt(norm, i, tmpl);
    if (score > best.score) best = { score, t: norm[i].t, index: i, width: tmpl.length * dt, symbolMs };
  }
  const lo = Math.max(0, best.index - nPer);
  const hi = Math.min(norm.length - tmpl.length, best.index + nPer);
  for (let i = lo; i <= hi; i++) {
    const score = scoreAt(norm, i, tmpl);
    if (score > best.score) best = { score, t: norm[i].t, index: i, width: tmpl.length * dt, symbolMs };
  }
  return best;
}

export function sliceBitsFrom(norm, t0, symbolMs, nBits) {
  const bits = [];
  for (let k = 0; k < nBits; k++) {
    const start = t0 + k * symbolMs + symbolMs * 0.28;
    const end = t0 + k * symbolMs + symbolMs * 0.72;
    let sum = 0;
    let n = 0;
    for (const p of norm) {
      if (p.t >= start && p.t < end) {
        sum += p.v;
        n++;
      }
    }
    bits.push(n && sum / n >= 0 ? 1 : 0);
  }
  return bits;
}

function tryDecode(bits, score, st, rate) {
  const symbols = [...PREAMBLE, ...bits];
  const lite = decodeLiteSymbols(symbols);
  if (lite.frame) {
    return {
      ...lite,
      score,
      contrast: st.contrast,
      stats: st,
      bitsHave: bits.length,
      bitsNeed: LITE_BODY_BITS,
      preamble: true,
      recovered: true,
      symbolMs: rate,
    };
  }
  const demo = decodeDemoSymbols(symbols);
  if (demo.frame) {
    return {
      ...demo,
      score,
      contrast: st.contrast,
      stats: st,
      bitsHave: bits.length,
      bitsNeed: 88,
      preamble: true,
      recovered: true,
      symbolMs: rate,
    };
  }
  const full = decodeSymbols(symbols);
  if (full.frame) {
    return {
      ...full,
      score,
      contrast: st.contrast,
      stats: st,
      bitsHave: bits.length,
      bitsNeed: 200,
      preamble: true,
      recovered: true,
      symbolMs: rate,
    };
  }
  const rejected = [lite, demo, full].map((r) => r.rejected).find((r) => r && r !== "sync-not-found");
  return {
    frame: null,
    rejected: rejected || "frame-short",
    preamble: true,
    recovered: false,
    score,
    contrast: st.contrast,
    stats: st,
    bitsHave: bits.length,
    bitsNeed: LITE_BODY_BITS,
    symbolMs: rate,
  };
}

export function decodeFromSeries(series, symbolMs) {
  const st = recentStats(series);
  const base = {
    frame: null,
    rejected: "sync-not-found",
    preamble: false,
    recovered: false,
    score: 0,
    contrast: st.contrast,
    stats: st,
    bitsHave: 0,
    bitsNeed: LITE_BODY_BITS,
    symbolMs,
  };
  if (series.samples.length < 8) return base;
  const dt = 16;
  const grid = resample(series, dt);
  if (grid.length < 16) return base;
  const norm = normalizeLocal(grid);
  const rates = [0.9, 0.96, 1, 1.04, 1.1].map((f) => symbolMs * f);
  let hit = { score: -1, t: 0, index: -1, width: 0, symbolMs };
  for (const rate of rates) {
    const cand = correlatePattern(norm, rate, PREAMBLE, dt);
    if (cand.score > hit.score) hit = cand;
  }
  base.score = hit.score;
  base.symbolMs = hit.symbolMs || symbolMs;
  if (hit.score < 0.28 || hit.index < 0) return base;

  const rate = hit.symbolMs || symbolMs;
  const phases = [-0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35].map((f) => rate * f);
  let best = { ...base, preamble: true, score: hit.score, rejected: "frame-short" };
  for (const phase of phases) {
    const bodyStart = hit.t + hit.width + phase;
    const availableMs = series.samples[series.samples.length - 1].t - bodyStart;
    const bitsHave = Math.max(0, Math.floor(availableMs / rate));
    if (bitsHave < LITE_BODY_BITS) {
      if (bitsHave > best.bitsHave) best.bitsHave = bitsHave;
      continue;
    }
    const bits = sliceBitsFrom(norm, bodyStart, rate, LITE_BODY_BITS + 8);
    const result = tryDecode(bits, hit.score, st, rate);
    if (result.frame) return result;
    if ((result.bitsHave || 0) >= (best.bitsHave || 0)) best = result;
  }
  return best;
}
