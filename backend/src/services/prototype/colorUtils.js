'use strict';

function parseColor(value) {
  const text = String(value || '').trim().toLowerCase();
  let m = text.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = text.match(/^#([0-9a-f]{6})/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.round(Number(n)));
  return null;
}
const toHex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
function luminance(color) {
  const rgb = parseColor(color); if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function saturation(color) {
  const rgb = parseColor(color); if (!rgb) return 0;
  const max = Math.max(...rgb); const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
}
function distance(a, b) {
  const x = parseColor(a); const y = parseColor(b);
  if (!x || !y) return Infinity;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(a, b, weightB) {
  const x = parseColor(a); const y = parseColor(b);
  if (!x || !y) return a;
  return toHex(x.map((v, i) => v * (1 - weightB) + y[i] * weightB));
}
const channels = (color) => { const rgb = parseColor(color); return rgb ? rgb.join(' ') : null; };

module.exports = { parseColor, toHex, luminance, saturation, distance, contrast, mix, channels };
