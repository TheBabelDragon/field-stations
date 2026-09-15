/** Camera brightness -> optical packet. CRC is authentication. Votes commit. */

import { PREAMBLE } from "./frame.js";
import { decodePacketSymbols, BODY_BITS } from "./packet.js";

export function recentStats(series, windowMs = 1800) {
  const all = series.samples;
  if (!all.length) return { min: 0, max: 0, mean: 0, variance: 0, contrast: 0 };
  const t1 = all[all.length - 1].t;
  const cut = t1 - windowMs;
  let min = 1;
  let max = 0;
  let n = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.t < cut) break;
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    n++;
  }
  if (!n) return { min: 0, max: 0, mean: 0, variance: 0, contrast: 0 };
  return { min, max, mean: (min + max) / 2, variance: 0, contrast: max - min };
}

export function resample(series, dt = 16) {
  const s = series.samples;
  if (s.length < 2) return [];
  const t1 = s[s.length - 1].t;
  const t0 = Math.max(s[0].t, t1 - 5000);
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

export function normalizeLocal(grid, win = 30) {
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
    const start = t0 + k * symbolMs + symbolMs * 0.3;
    const end = t0 + k * symbolMs + symbolMs * 0.7;
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
    packet: null,
    rejected: "sync-not-found",
    preamble: false,
    score: 0,
    contrast: st.contrast,
    stats: st,
    bitsHave: 0,
    bitsNeed: BODY_BITS,
    symbolMs,
  };
  if (series.samples.length < 8) return base;
  const dt = 16;
  const grid = resample(series, dt);
  if (grid.length < 16) return base;
  const norm = normalizeLocal(grid);
  const rates = [0.94, 1, 1.06].map((f) => symbolMs * f);
  let hit = { score: -1, t: 0, index: -1, width: 0, symbolMs };
  for (const rate of rates) {
    const cand = correlatePattern(norm, rate, PREAMBLE, dt);
    if (cand.score > hit.score) hit = cand;
  }
  base.score = hit.score;
  base.symbolMs = hit.symbolMs || symbolMs;
  if (hit.score < 0.3 || hit.index < 0) return base;

  const rate = hit.symbolMs || symbolMs;
  let best = { ...base, preamble: true, score: hit.score, rejected: "frame-short" };
  for (const phase of [-0.2, -0.1, 0, 0.1, 0.2].map((f) => rate * f)) {
    const bodyStart = hit.t + hit.width + phase;
    const availableMs = series.samples[series.samples.length - 1].t - bodyStart;
    const bitsHave = Math.max(0, Math.floor(availableMs / rate));
    if (bitsHave > best.bitsHave) best.bitsHave = bitsHave;
    if (bitsHave < BODY_BITS) continue;
    const bits = sliceBitsFrom(norm, bodyStart, rate, BODY_BITS);
    const decoded = decodePacketSymbols([...PREAMBLE, ...bits]);
    if (decoded.packet) {
      return {
        ...decoded,
        score: hit.score,
        contrast: st.contrast,
        stats: st,
        bitsHave: bits.length,
        bitsNeed: BODY_BITS,
        symbolMs: rate,
      };
    }
    best = {
      ...best,
      rejected: decoded.rejected || "crc-mismatch",
      bitsHave,
      preamble: true,
    };
  }
  return best;
}
