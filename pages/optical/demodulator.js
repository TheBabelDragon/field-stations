/** Brightness timeline -> symbols. Camera-native correlator first, hard slice second. */

import { PREAMBLE, decodeDemoSymbols, decodeSymbols } from "./frame.js";

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

export function recentStats(series, windowMs = 2500) {
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

export function resample(series, dt = 20) {
  const s = series.samples;
  if (s.length < 2) return [];
  const out = [];
  let i = 0;
  for (let t = s[0].t; t <= s[s.length - 1].t; t += dt) {
    while (i + 1 < s.length && s[i + 1].t < t) i++;
    const a = s[i];
    const b = s[Math.min(i + 1, s.length - 1)];
    const span = Math.max(1, b.t - a.t);
    const u = Math.min(1, Math.max(0, (t - a.t) / span));
    out.push({ t, v: a.value + (b.value - a.value) * u });
  }
  return out;
}

export function normalizeLocal(grid, win = 48) {
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

export function correlatePattern(norm, symbolMs, pattern, dt) {
  const tmpl = [];
  const nPer = Math.max(2, Math.round(symbolMs / dt));
  for (const bit of pattern) {
    const val = bit ? 1 : -1;
    for (let i = 0; i < nPer; i++) tmpl.push(val);
  }
  let best = { score: -1, t: 0, index: -1, width: tmpl.length * dt };
  if (norm.length < tmpl.length) return best;
  for (let i = 0; i <= norm.length - tmpl.length; i++) {
    let s = 0;
    for (let j = 0; j < tmpl.length; j++) s += norm[i + j].v * tmpl[j];
    const score = s / tmpl.length;
    if (score > best.score) best = { score, t: norm[i].t, index: i, width: tmpl.length * dt };
  }
  return best;
}

export function sliceBitsFrom(norm, t0, symbolMs, nBits) {
  const bits = [];
  for (let k = 0; k < nBits; k++) {
    const start = t0 + k * symbolMs;
    const end = start + symbolMs;
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

export function decodeFromSeries(series, symbolMs) {
  const st = recentStats(series);
  const base = {
    frame: null,
    rejected: "sync-not-found",
    preamble: false,
    score: 0,
    contrast: st.contrast,
    stats: st,
    bitsHave: 0,
    bitsNeed: 88,
  };
  if (series.samples.length < 8) return base;
  const dt = 20;
  const grid = resample(series, dt);
  if (grid.length < 16) return base;
  const norm = normalizeLocal(grid);
  const hit = correlatePattern(norm, symbolMs, PREAMBLE, dt);
  base.score = hit.score;
  if (hit.score < 0.32 || hit.index < 0) return base;

  const bodyStart = hit.t + hit.width;
  const availableMs = series.samples[series.samples.length - 1].t - bodyStart;
  const bitsHave = Math.max(0, Math.floor(availableMs / symbolMs));
  const bits = sliceBitsFrom(norm, bodyStart, symbolMs, Math.max(bitsHave, 0));
  const symbols = [...PREAMBLE, ...bits];
  const demo = decodeDemoSymbols(symbols);
  if (demo.frame) {
    demo.score = hit.score;
    demo.contrast = st.contrast;
    demo.stats = st;
    demo.bitsHave = bits.length;
    demo.bitsNeed = 88;
    demo.preamble = true;
    return demo;
  }
  const full = decodeSymbols(symbols);
  if (full.frame) {
    full.score = hit.score;
    full.contrast = st.contrast;
    full.stats = st;
    full.bitsHave = bits.length;
    full.bitsNeed = 200;
    full.preamble = true;
    return full;
  }
  const rejected = demo.rejected && demo.rejected !== "sync-not-found" ? demo.rejected : full.rejected;
  return {
    ...base,
    rejected: rejected === "frame-short" ? "frame-short" : (rejected || "frame-short"),
    preamble: true,
    bitsHave: bits.length,
    score: hit.score,
  };
}
