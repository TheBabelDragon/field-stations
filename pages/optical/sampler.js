/** Camera / canvas -> brightness time series of one small LED region. */

export function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function findBrightestCell(imageData, cells = 12, windowFrac = 0.08) {
  const { width, height, data } = imageData;
  const ww = Math.max(4, Math.floor(width * windowFrac));
  const hh = Math.max(4, Math.floor(height * windowFrac));
  let best = { x: width / 2, y: height / 2, value: 0 };
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const x0 = Math.floor((cx / cells) * (width - ww));
      const y0 = Math.floor((cy / cells) * (height - hh));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y0 + hh; y += 2) {
        for (let x = x0; x < x0 + ww; x += 2) {
          const i = (y * width + x) * 4;
          sum += luma(data[i], data[i + 1], data[i + 2]);
          n++;
        }
      }
      const value = n ? sum / n : 0;
      if (value > best.value) best = { x: x0 + ww / 2, y: y0 + hh / 2, value, w: ww, h: hh };
    }
  }
  return best;
}

export function sampleRegion(imageData, x, y, w, h) {
  const { width, height, data } = imageData;
  const x0 = Math.max(0, Math.floor(x - w / 2));
  const y0 = Math.max(0, Math.floor(y - h / 2));
  const x1 = Math.min(width, x0 + Math.max(2, Math.floor(w)));
  const y1 = Math.min(height, y0 + Math.max(2, Math.floor(h)));
  let sum = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * width + xx) * 4;
      sum += luma(data[i], data[i + 1], data[i + 2]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

export class TimeSeries {
  constructor(maxMs = 12000) {
    this.maxMs = maxMs;
    this.samples = [];
  }

  push(t, value) {
    this.samples.push({ t, value });
    const cut = t - this.maxMs;
    while (this.samples.length && this.samples[0].t < cut) this.samples.shift();
  }

  stats() {
    if (!this.samples.length) return { min: 0, max: 0, mean: 0, variance: 0 };
    let min = 1;
    let max = 0;
    let sum = 0;
    for (const s of this.samples) {
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
      sum += s.value;
    }
    const mean = sum / this.samples.length;
    let v = 0;
    for (const s of this.samples) v += (s.value - mean) ** 2;
    return { min, max, mean, variance: v / this.samples.length };
  }

  values() {
    return this.samples.map((s) => s.value);
  }
}
