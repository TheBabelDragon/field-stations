/** Brightness timeline -> OOK symbols. Logical symbols stay separate from PHY. */

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

export function decodeWaveform(samples, samplesPerSymbol, decodeSymbols, threshold = null) {
  let last = { frame: null, rejected: "sync-not-found" };
  for (let phase = 0; phase < samplesPerSymbol; phase++) {
    const sliced = waveformToSymbols(samples.slice(phase), samplesPerSymbol, threshold);
    const result = decodeSymbols(sliced);
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
  const mean = sum / n;
  return { min, max, mean, variance: 0, contrast: max - min };
}

export function timedToSymbols(samples, t0, symbolMs, threshold) {
  if (!samples.length) return [];
  const t1 = samples[samples.length - 1].t;
  const symbols = [];
  let last = samples[0].value;
  let i = 0;
  for (let t = t0; t + symbolMs * 0.55 <= t1; t += symbolMs) {
    const end = t + symbolMs;
    let sum = 0;
    let n = 0;
    while (i < samples.length && samples[i].t < t) i++;
    let j = i;
    while (j < samples.length && samples[j].t < end) {
      sum += samples[j].value;
      n++;
      j++;
    }
    if (n) {
      last = sum / n;
    }
    symbols.push(last >= threshold ? 1 : 0);
  }
  return symbols;
}

export function decodeTimed(series, symbolMs, decodeFns) {
  const decoders = Array.isArray(decodeFns) ? decodeFns : [decodeFns];
  const st = recentStats(series);
  if (st.contrast < 0.06) {
    return { frame: null, rejected: "sync-not-found", contrast: st.contrast, stats: st };
  }
  const threshold = (st.min + st.max) / 2;
  let last = { frame: null, rejected: "sync-not-found", contrast: st.contrast, stats: st };
  const offsets = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => symbolMs * f);
  const tStart = series.samples[0].t;
  for (const off of offsets) {
    const symbols = timedToSymbols(series.samples, tStart + off, symbolMs, threshold);
    for (const decode of decoders) {
      const result = decode(symbols);
      result.contrast = st.contrast;
      result.stats = st;
      if (result.frame) return result;
      if (result.rejected !== "sync-not-found") last = result;
    }
  }
  return last;
}
