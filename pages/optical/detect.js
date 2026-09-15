/** Find a bright, blinking, periodic, stable disc — not the brightest lamp. */

import { luma, sampleRegion } from "./sampler.js";

export const COLS = 12;
export const ROWS = 8;

export function cellGrid(image) {
  const g = new Float32Array(COLS * ROWS);
  const cw = image.width / COLS;
  const ch = image.height / ROWS;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      g[r * COLS + c] = sampleRegion(image, (c + 0.5) * cw, (r + 0.5) * ch, cw * 0.85, ch * 0.85);
    }
  }
  return g;
}

export function scoreCells(history) {
  if (history.length < 6) return null;
  let best = { i: -1, score: 0, contrast: 0, brightness: 0 };
  const n = COLS * ROWS;
  for (let i = 0; i < n; i++) {
    let min = 1;
    let max = 0;
    let sum = 0;
    let flips = 0;
    let prev = history[0][i];
    const midGuess = 0.5;
    for (const g of history) {
      const v = g[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      const on = v >= midGuess;
      const was = prev >= midGuess;
      if (on !== was) flips++;
      prev = v;
    }
    const brightness = sum / history.length;
    const contrast = max - min;
    const periodicity = Math.min(1, flips / Math.max(3, history.length * 0.35));
    const score = brightness * contrast * (0.25 + periodicity);
    if (score > best.score) best = { i, score, contrast, brightness, periodicity };
  }
  if (best.i < 0 || best.contrast < 0.08 || best.score < 0.02) return null;
  return {
    nx: ((best.i % COLS) + 0.5) / COLS,
    ny: (Math.floor(best.i / COLS) + 0.5) / ROWS,
    ...best,
  };
}

export function estimateClockMs(samples) {
  if (samples.length < 16) return null;
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  if (max - min < 0.12) return null;
  const mid = (min + max) / 2;
  const runs = [];
  let last = samples[0].value >= mid;
  let t = samples[0].t;
  for (let i = 1; i < samples.length; i++) {
    const on = samples[i].value >= mid;
    if (on !== last) {
      const dur = samples[i].t - t;
      if (dur > 25 && dur < 280) runs.push(dur);
      t = samples[i].t;
      last = on;
    }
  }
  if (runs.length < 6) return null;
  runs.sort((a, b) => a - b);
  const short = runs.slice(0, Math.max(4, Math.floor(runs.length * 0.6)));
  return short[Math.floor(short.length / 2)];
}

export function sliceFrom(samples, t0, symbolMs, nBits) {
  if (!samples.length) return [];
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  const mid = (min + max) / 2;
  const bits = [];
  for (let k = 0; k < nBits; k++) {
    const a = t0 + k * symbolMs + symbolMs * 0.3;
    const b = t0 + k * symbolMs + symbolMs * 0.7;
    let sum = 0;
    let n = 0;
    for (const s of samples) {
      if (s.t >= a && s.t < b) {
        sum += s.value;
        n++;
      }
    }
    if (!n) break;
    bits.push(sum / n >= mid ? 1 : 0);
  }
  return bits;
}

export function correlateStart(samples, symbolMs, pattern) {
  if (samples.length < 8) return { score: -1, t: 0 };
  const dt = 16;
  const t1 = samples[samples.length - 1].t;
  const tFirst = samples[0].t;
  const tmpl = [];
  const nPer = Math.max(2, Math.round(symbolMs / dt));
  for (const bit of pattern) {
    const v = bit ? 1 : -1;
    for (let i = 0; i < nPer; i++) tmpl.push(v);
  }
  function valueAt(t) {
    let i = 0;
    while (i + 1 < samples.length && samples[i + 1].t < t) i++;
    return samples[i].value;
  }
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  const mid = (min + max) / 2;
  const amp = Math.max(0.05, (max - min) / 2);
  let best = { score: -1, t: tFirst };
  const width = tmpl.length * dt;
  for (let t = tFirst; t + width <= t1; t += dt) {
    let s = 0;
    for (let j = 0; j < tmpl.length; j++) {
      const v = (valueAt(t + j * dt) - mid) / amp;
      s += v * tmpl[j];
    }
    const score = s / tmpl.length;
    if (score > best.score) best = { score, t };
  }
  return { ...best, width };
}
