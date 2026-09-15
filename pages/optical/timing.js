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

function symbolMean(samples, t0, symbolMs, k) {
  const a = t0 + k * symbolMs + symbolMs * 0.3;
  const b = t0 + k * symbolMs + symbolMs * 0.7;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += valueAt(samples, a + (b - a) * ((i + 0.5) / 4));
  }
  return sum / 4;
}

export function scorePattern(samples, t0, symbolMs, pattern) {
  const { mid, amp } = extrema(samples);
  let s = 0;
  for (let k = 0; k < pattern.length; k++) {
    const v = (symbolMean(samples, t0, symbolMs, k) - mid) / amp;
    s += v * (pattern[k] ? 1 : -1);
  }
  return s / pattern.length;
}

export function correlatePattern(samples, symbolMs, pattern, stepMs = null) {
  if (!samples || samples.length < 8 || symbolMs <= 0) {
    return { score: -1, t: 0, width: 0, symbolMs };
  }
  const tFirst = samples[0].t;
  const tLast = samples[samples.length - 1].t;
  const width = pattern.length * symbolMs;
  if (tLast - tFirst < width * 0.8) return { score: -1, t: tFirst, width, symbolMs };
  const step = stepMs || Math.max(8, Math.round(symbolMs / 8));
  let best = { score: -1, t: tFirst, width, symbolMs };
  for (let t = tFirst; t + width * 0.5 <= tLast; t += step) {
    const score = scorePattern(samples, t, symbolMs, pattern);
    if (score > best.score) best = { score, t, width, symbolMs };
  }
  const lo = Math.max(tFirst, best.t - symbolMs);
  const hi = Math.min(tLast, best.t + symbolMs);
  for (let t = lo; t <= hi; t += 4) {
    const score = scorePattern(samples, t, symbolMs, pattern);
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
  if (!clock || clock.score < 0) return { score: -1, t: 0, width: 0 };
  const tStart = clock.t0 + clock.symbolMs * (CLOCK_TRAIN.length - 1);
  const tEnd = clock.t0 + clock.symbolMs * (CLOCK_TRAIN.length + SYNC.length + 2);
  const window = samples.filter((s) => s.t >= tStart - clock.symbolMs && s.t <= tEnd);
  const hit = correlatePattern(window.length ? window : samples, clock.symbolMs, SYNC, 4);
  return { score: hit.score, t: hit.t, width: hit.width };
}

export const CLOCK_SCORE_MIN = 0.28;
