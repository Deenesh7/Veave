/**
 * Photo finishing: a deterministic, measured correction of lighting, colour and clarity.
 *
 * It runs on every enhanced photo (the AI result, or the owner's original when the AI result cannot be used). It first MEASURES the
 * picture (exposure, shadows, highlights, tonal range, colour cast, sharpness) and only corrects what is actually wrong, with bounded
 * strength, so a photo that is already good is barely touched and a dark, flat or tinted one is lifted to a natural look.
 * Every adjustment keeps hue (it works on luminance) and nothing is invented: the scene, subject and composition are unchanged.
 */

const MAX_SAT = 0.5;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (x) => x * x * (3 - 2 * x);

/** Measures a picture from a raw pixel buffer (channels 3 or 4, 8 bit). Samples at most ~250k pixels. */
function analyze(data, { width, height, channels }) {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 250000)));
  const hist = new Uint32Array(256);
  let count = 0; let sumL = 0; let sumR = 0; let sumG = 0; let sumB = 0; let neutral = 0; let chroma = 0;
  let shadows = 0; let highlights = 0; let edge = 0; let edgeCount = 0; let satNum = 0; let satDen = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const l = luma(r, g, b);
      hist[Math.round(l)] += 1; count += 1; sumL += l;
      if (l > 12 && l < 243) { sumR += r; sumG += g; sumB += b; neutral += 1; }
      const top = Math.max(r, g, b);
      chroma += top - Math.min(r, g, b);
      if (top > 24) { satNum += top - Math.min(r, g, b); satDen += top; }
      if (l < 38) shadows += 1;
      if (l > 235) highlights += 1;
      if (x + step < width && y + step < height) {
        const j = ((y + step) * width + x + step) * channels;
        edge += Math.abs(l - luma(data[j], data[j + 1], data[j + 2]));
        edgeCount += 1;
      }
    }
  }
  const percentile = (p) => { let acc = 0; const target = count * p; for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  return {
    mean: sumL / count / 255,
    median: percentile(0.5) / 255,
    low: percentile(0.005),
    high: percentile(0.995),
    shadowShare: shadows / count,
    highlightShare: highlights / count,
    chroma: chroma / count / 255,
    // Colour richness independent of brightness: chroma over brightness summed across the picture (so deep shadows, where colour is
    // mostly noise, count little). Comparable between a dark photo and its brightened version.
    sat: satDen ? satNum / satDen : 0,
    means: neutral ? [sumR / neutral, sumG / neutral, sumB / neutral] : [128, 128, 128],
    // Average local contrast between neighbouring samples: low means a soft / blurry picture.
    detail: edgeCount ? edge / edgeCount / 255 : 0,
    pixels: width * height
  };
}

/** Decides the corrections from the measurements. Everything is bounded so the result stays natural. */
function plan(m) {
  const mean = m.means.reduce((a, b) => a + b, 0) / 3;
  const gains = m.means.map((value) => clamp(mean / Math.max(value, 1), 0.9, 1.1));
  const cast = Math.max(...gains) - Math.min(...gains);
  const whiteBalance = cast > 0.06 ? gains.map((gain) => 1 + (gain - 1) * 0.65) : [1, 1, 1];

  // Black stays lifted a little: crushing the darkest tones to zero loses shadow detail and makes smooth gradients band.
  // A hazy / washed-out picture has no true blacks at all: there the black point is raised to remove the haze.
  const blackPoint = m.low > 60 ? clamp(m.low - 4, 14, 170) : clamp(m.low - 2, 0, 14);
  const whitePoint = clamp(m.high + 2, 208, 255);
  const range = Math.max(40, whitePoint - blackPoint);
  const afterLevels = clamp((m.median * 255 - blackPoint) / range, 0.02, 0.98);
  const target = 0.47;
  let gamma = Math.log(target) / Math.log(afterLevels); // <1 brightens mid-tones, >1 darkens
  gamma = 1 + (clamp(gamma, 0.55, 1.45) - 1) * 0.95;
  if (Math.abs(gamma - 1) < 0.04) gamma = 1;

  const shadowLift = m.shadowShare > 0.18 ? 0.5 : m.shadowShare > 0.1 ? 0.32 : 0.12;
  const highlightRecovery = m.highlightShare > 0.06 ? 0.34 : m.highlightShare > 0.025 ? 0.2 : 0.06;
  const flat = range < 190 ? clamp((190 - range) / 190, 0, 0.6) : 0;
  const contrast = 0.1 + flat * 0.45;
  const saturation = m.chroma < 0.1 ? 1.14 : m.chroma < 0.18 ? 1.08 : 1.03;
  // A soft picture gets more sharpening; an already crisp one almost none.
  const soft = clamp((0.06 - m.detail) / 0.06, 0, 1);
  const sharpenSigma = clamp(0.55 + soft * 0.55 + Math.max(0, Math.log10(Math.max(m.pixels, 1) / 1e6)) * 0.25, 0.5, 1.4);
  return { whiteBalance, blackPoint, whitePoint, gamma, shadowLift, highlightRecovery, contrast, saturation, sharpenSigma, sharpenAmount: 0.6 + soft * 0.9 };
}

/** The tone curve for luminance 0..255 -> 0..255. */
function toneCurve(p) {
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v += 1) {
    let x = clamp((v - p.blackPoint) / (p.whitePoint - p.blackPoint), 0, 1);
    x = x ** p.gamma;
    x += p.shadowLift * x * (1 - x) * (1 - x) * 2;
    x -= p.highlightRecovery * x * x * (1 - x) * 2;
    x += p.contrast * (smooth(clamp(x, 0, 1)) - x);
    lut[v] = clamp(x, 0, 1) * 255;
  }
  return lut;
}

/**
 * Corrects the picture in place and returns what was done. `info` is { width, height, channels } of the raw buffer.
 * @returns {{ plan: object, before: object, after: object, changed: boolean }}
 */
function finishPixels(data, info, { referenceSat = null } = {}) {
  const before = analyze(data, info);
  const p = plan(before);
  const lut = toneCurve(p);
  const { channels } = info;
  const total = info.width * info.height;
  const [gr, gg, gb] = p.whiteBalance;
  for (let n = 0; n < total; n += 1) {
    const i = n * channels;
    let r = data[i] * gr; let g = data[i + 1] * gg; let b = data[i + 2] * gb;
    const l = luma(r, g, b);
    const target = lut[Math.min(255, Math.max(0, Math.round(l)))];
    // Scale colour with luminance so hue is kept; in the deepest shadows add the difference instead of amplifying noise.
    const w = clamp(1 - l / 24, 0, 1);
    const ratio = Math.min(target / Math.max(l, 1), 2.6);
    const delta = target - l;
    r = r + (delta * w) + (r * ratio - r) * (1 - w);
    g = g + (delta * w) + (g * ratio - g) * (1 - w);
    b = b + (delta * w) + (b * ratio - b) * (1 - w);
    data[i] = r < 0 ? 0 : r > 254.5 ? 255 : (r + 0.5) | 0;
    data[i + 1] = g < 0 ? 0 : g > 254.5 ? 255 : (g + 0.5) | 0;
    data[i + 2] = b < 0 ? 0 : b > 254.5 ? 255 : (b + 0.5) | 0;
  }
  // Colour: never let the picture end up richer than the photographer's own (an AI result is often over-saturated, and brightening
  // a dark photo makes its colours look stronger). Target = the original's colour richness plus a small lift; a dull photo gets more.
  const mid = analyze(data, info);
  const base = referenceSat ?? before.sat;
  const lift = base < 0.2 ? 1.18 : base < 0.35 ? 1.1 : 1.04;
  // Natural photographs rarely exceed ~0.5 on this scale; above it colours look neon (skies, skin and food are the first to suffer).
  const target = Math.min(base * lift, MAX_SAT);
  const k = mid.sat > 0 ? clamp(target / mid.sat, 0.45, 1.3) : 1;
  if (Math.abs(k - 1) > 0.03) {
    for (let n = 0; n < total; n += 1) {
      const i = n * channels;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const gray = luma(r, g, b);
      const nr = gray + (r - gray) * k; const ng = gray + (g - gray) * k; const nb = gray + (b - gray) * k;
      data[i] = nr < 0 ? 0 : nr > 254.5 ? 255 : (nr + 0.5) | 0;
      data[i + 1] = ng < 0 ? 0 : ng > 254.5 ? 255 : (ng + 0.5) | 0;
      data[i + 2] = nb < 0 ? 0 : nb > 254.5 ? 255 : (nb + 0.5) | 0;
    }
  }
  const after = analyze(data, info);
  return { plan: { ...p, saturation: k }, before, after, changed: true };
}

module.exports = { analyze, plan, toneCurve, finishPixels };
