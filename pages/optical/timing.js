/** Recover symbol clock from the known CLOCK_TRAIN waveform.
 * Run-length estimates and samples[0] are not authoritative.
 */

import { CLOCK_TRAIN, SYNC } from "./phy.js";

function extrema(samples) {
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  return { min, max, mid: (min + max) / 2, amp: Math.max(0.05, (max - min) / 2) };
}

function valueAt(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return samples[0].value;
  if (t >= samples[hi].t) return samples[hi].value;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[Math.min(lo + 1, samples.length - 1)];
  const span = Math.max(1, b.t - a.t);
  const u = Math.min(1, Math.max(0, (t - a.t) / span));
  return a.value + (b.value - a.value) * u;
}

function template(pattern, symbolMs, dt) {
  const nPer = Math.max(2, Math.round(symbolMs / dt));
  const tmpl = [];
  for (const bit of pattern) {
    const v = bit ? 1 : -1;
    for (let i = 0; i < nPer; i++) tmpl.push(v);
  }
  return { tmpl, nPer, width: tmpl.length * dt };
}

function scoreTemplate(samples, t0, tmpl, dt, mid, amp) {
  let s = 0;
  for (let j = 0; j < tmpl.length; j++) {
    s += ((valueAt(samples, t0 + j * dt) - mid) / amp) * tmpl[j];
  }
  return s / tmpl.length;
}

export function correlatePattern(samples, symbolMs, pattern, dt = 16) {
  if (!samples || samples.length < 8) return { score: -1, t: 0, width: 0, symbolMs };
  const { mid, amp } = extrema(samples);
  const { tmpl, width } = template(pattern, symbolMs, dt);
  const tFirst = samples[0].t;
  const tLast = samples[samples.length - 1].t;
  if (tLast - tFirst < width) return { score: -1, t: tFirst, width, symbolMs };
  let best = { score: -1, t: tFirst, width, symbolMs };
  const step = Math.max(dt, Math.round(symbolMs / 6));
  for (let t = tFirst; t + width <= tLast; t += step) {
    const score = scoreTemplate(samples, t, tmpl, dt, mid, amp);
    if (score > best.score) best = { score, t, width, symbolMs };
  }
  const lo = Math.max(tFirst, best.t - symbolMs);
  const hi = Math.min(tLast - width, best.t + symbolMs);
  for (let t = lo; t <= hi; t += dt) {
    const score = scoreTemplate(samples, t, tmpl, dt, mid, amp);
    if (score > best.score) best = { score, t, width, symbolMs };
  }
  return best;
}

/** Authoritative clock: period + phase from CLOCK_TRAIN. hintMs is optional. */
export function recoverClockFromTrain(samples, hintMs = null) {
  const fallback = {
    symbolMs: hintMs || 120,
    t0: samples?.[0]?.t || 0,
    score: -1,
    width: 0,
    confidence: 0,
    source: "none",
  };
  if (!samples || samples.length < 12) return fallback;

  const periods = new Set();
  if (hintMs && hintMs > 40) {
    for (const f of [0.72, 0.84, 0.92, 1, 1.08, 1.16, 1.28]) periods.add(Math.round(hintMs * f));
  }
  for (const p of [70, 80, 90, 100, 110, 120, 130, 150, 180]) periods.add(p);

  let best = { ...fallback };
  for (const symbolMs of periods) {
    const hit = correlatePattern(samples, symbolMs, CLOCK_TRAIN);
    if (hit.score > best.score) {
      best = {
        symbolMs,
        t0: hit.t,
        score: hit.score,
        width: hit.width,
        confidence: Math.max(0, Math.min(1, hit.score)),
        source: "clock-train",
      };
    }
  }

  const center = best.symbolMs;
  for (const symbolMs of [center - 6, center - 3, center + 3, center + 6]) {
    if (symbolMs < 50) continue;
    const hit = correlatePattern(samples, symbolMs, CLOCK_TRAIN);
    if (hit.score > best.score) {
      best = {
        symbolMs,
        t0: hit.t,
        score: hit.score,
        width: hit.width,
        confidence: Math.max(0, Math.min(1, hit.score)),
        source: "clock-train",
      };
    }
  }
  return best;
}

export function recoverSync(samples, clock) {
  if (!clock || clock.score < 0) return { score: -1, t: 0 };
  const searchFrom = clock.t0 + clock.width * 0.7;
  const window = samples.filter((s) => s.t >= searchFrom - clock.symbolMs && s.t <= searchFrom + clock.symbolMs * (SYNC.length + 4));
  if (window.length < 4) {
    const hit = correlatePattern(samples, clock.symbolMs, SYNC);
    return { score: hit.score, t: hit.t, width: hit.width };
  }
  const hit = correlatePattern(window.length ? window : samples, clock.symbolMs, SYNC);
  return { score: hit.score, t: hit.t, width: hit.width };
}

export const CLOCK_SCORE_MIN = 0.28;
