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

export function timedToSymbols(series, symbolMs, threshold = null) {
  if (!series.samples.length) return [];
  if (threshold == null) {
    const st = series.stats();
    threshold = (st.min + st.max) / 2;
  }
  const t0 = series.samples[0].t;
  const t1 = series.samples[series.samples.length - 1].t;
  const symbols = [];
  for (let t = t0; t + symbolMs * 0.6 <= t1; t += symbolMs) {
    let sum = 0;
    let n = 0;
    for (const s of series.samples) {
      if (s.t >= t && s.t < t + symbolMs) {
        sum += s.value;
        n++;
      }
    }
    if (!n) continue;
    symbols.push(sum / n >= threshold ? 1 : 0);
  }
  return symbols;
}

export function decodeTimed(series, symbolMs, decodeSymbols) {
  const st = series.stats();
  const threshold = (st.min + st.max) / 2;
  let last = { frame: null, rejected: "sync-not-found" };
  const offsets = [0, symbolMs * 0.25, symbolMs * 0.5, symbolMs * 0.75];
  for (const off of offsets) {
    const tBase = series.samples[0].t + off;
    const shifted = {
      samples: series.samples.filter((s) => s.t >= tBase).map((s) => ({ t: s.t - off, value: s.value })),
      stats() { return st; },
    };
    if (!shifted.samples.length) continue;
    const symbols = timedToSymbols(shifted, symbolMs, threshold);
    const result = decodeSymbols(symbols);
    if (result.frame) return result;
    last = result;
  }
  return last;
}
