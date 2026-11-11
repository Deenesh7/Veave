'use strict';

const googleFonts = require('../clone/googleFonts');
const { parseColor, luminance, saturation, distance, contrast, mix, channels, toHex } = require('./colorUtils');

// Stage 7: the design-system manifest. Built from measured (computed) styles of every captured page, before any page
// is generated. Source-specific values are kept as they are: nothing is replaced by a default theme.

const ROLES = ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'nav', 'li', 'small', 'footer'];
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const round = (n, step = 1) => Math.round(n / step) * step;

// Sites often name a font file's face ("SourceSansProBold") instead of the family. Try the family a person would mean.
const RENAMED = { 'source sans pro': 'Source Sans 3', 'source serif pro': 'Source Serif 4' };
function familyVariants(original) {
  const spaced = String(original || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  const bare = spaced.replace(/\b(Bold|Regular|Light|Medium|Semi ?Bold|Extra ?Bold|Black|Thin|Italic|Book|Roman|Heavy|Demi|Variable|VF)\b/gi, '').replace(/\s+/g, ' ').trim();
  const out = [spaced.trim(), bare];
  if (RENAMED[bare.toLowerCase()]) out.push(RENAMED[bare.toLowerCase()]);
  return [...new Set(out.filter(Boolean))];
}
function findByVariants(catalogue, original) {
  for (const name of familyVariants(original)) { const hit = googleFonts.findFamily(catalogue, name); if (hit) return hit; }
  return null;
}

function firstFamily(stack) { return String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); }
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system', 'blinkmacsystemfont']);

function tally() {
  const map = new Map();
  return { add(key, by = 1) { if (key === null || key === undefined || key === '') return; map.set(key, (map.get(key) || 0) + by); }, top(n = 1) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count })); }, size: () => map.size, map };
}

/** Most common typography record for a role across all pages (desktop), plus the mobile size where it differs. */
function pickTypography(pages) {
  const out = {};
  ROLES.forEach((role) => {
    const t = tally(); const samples = new Map(); const mobile = tally();
    pages.forEach((page) => {
      const d = page.desktop?.typography?.[role];
      if (d) { const key = JSON.stringify({ f: d.fontFamily, w: d.fontWeight, s: d.fontSize, l: d.lineHeight, ls: d.letterSpacing, c: d.color, tt: d.textTransform }); t.add(key, d.count || 1); if (!samples.has(key)) samples.set(key, d); }
      const m = page.mobile?.typography?.[role]; if (m) mobile.add(m.fontSize, m.count || 1);
    });
    const best = t.top(1)[0];
    if (!best) return;
    const s = samples.get(best.value);
    const size = px(s.fontSize);
    const lh = px(s.lineHeight);
    out[role] = {
      fontFamily: s.fontFamily, family: firstFamily(s.fontFamily), weight: Number(s.fontWeight) || 400, size, sizeMobile: px(mobile.top(1)[0]?.value) || size,
      lineHeight: lh && size ? Number((lh / size).toFixed(3)) : 1.5, letterSpacing: s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing) || 0,
      textTransform: s.textTransform || 'none', color: s.color || null
    };
  });
  return out;
}

async function resolveFonts(typography, { getCatalogue = googleFonts.getCatalogue } = {}) {
  const heading = typography.h1 || typography.h2 || typography.h3 || typography.p;
  const body = typography.p || typography.li || typography.a || heading;
  const families = [heading, body, typography.button, typography.nav].filter(Boolean);
  let catalogue = [];
  try { catalogue = await getCatalogue(); } catch { catalogue = []; }
  const resolve = (record) => {
    if (!record) return null;
    const original = record.family;
    const stackNames = String(record.fontFamily).split(',').map((n) => n.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const hit = googleFonts.findFamily(catalogue, record.fontFamily) || findByVariants(catalogue, original);
    const fallbackGeneric = stackNames.find((n) => GENERIC.has(n.toLowerCase())) || (googleFonts.categoryOf ? (/serif/i.test(record.fontFamily) && !/sans/i.test(record.fontFamily) ? 'serif' : 'sans-serif') : 'sans-serif');
    return {
      original, stack: record.fontFamily,
      // A free web font the project can load. Null for system fonts and for commercial fonts the catalogue does not have.
      google: hit ? (hit.family || hit) : null,
      isSystem: GENERIC.has(original.toLowerCase()) || /^(helvetica|arial|georgia|times|times new roman|courier|verdana|tahoma|trebuchet ms|segoe ui|sf pro|-apple-system)/i.test(original),
      fallback: fallbackGeneric, weights: [...new Set(families.filter((f) => f.family === original).map((f) => f.weight))].sort((a, b) => a - b)
    };
  };
  return { heading: resolve(heading), body: resolve(body), button: resolve(typography.button), nav: resolve(typography.nav), catalogueSize: catalogue.length };
}

function pickColors(pages) {
  const bg = tally(); const text = tally(); const border = tally(); const pageBg = tally(); const bodyText = tally(); const btnBg = tally(); const btnText = tally(); const link = tally(); const cardBg = tally();
  pages.forEach((page) => {
    const m = page.desktop; if (!m) return;
    (m.colors?.background || []).forEach((c) => bg.add(c.value, c.count));
    (m.colors?.text || []).forEach((c) => text.add(c.value, c.count));
    (m.colors?.borders || []).forEach((c) => { const color = String(c.value).split(' ').pop(); border.add(color, c.count); });
    pageBg.add(m.pageBackground); bodyText.add(m.bodyColor);
    if (m.buttons) { btnBg.add(m.buttons.background); btnText.add(m.buttons.color); }
    if (m.linkColor) link.add(m.linkColor);
    if (m.cards?.background) cardBg.add(m.cards.background);
  });
  const background = pageBg.top(1)[0]?.value || '#ffffff';
  const foreground = bodyText.top(1)[0]?.value || (luminance(background) > 0.5 ? '#111111' : '#f5f5f5');
  const dark = luminance(background) < 0.35;
  // surface: the card colour, else the most common background that differs from the page background
  const distinctBg = bg.top(12).map((x) => x.value).filter((c) => distance(c, background) > 6);
  const surface = cardBg.top(1)[0]?.value && distance(cardBg.top(1)[0].value, background) > 4 ? cardBg.top(1)[0].value : (distinctBg[0] || mix(background, dark ? '#ffffff' : '#000000', 0.04));
  const surface2 = distinctBg.find((c) => distance(c, surface) > 8 && distance(c, background) > 8) || mix(surface, dark ? '#ffffff' : '#000000', 0.05);
  const mutedCandidates = text.top(10).map((x) => x.value).filter((c) => distance(c, foreground) > 40 && contrast(c, background) >= 2.2);
  const muted = mutedCandidates[0] || mix(foreground, background, 0.45);
  // primary: the button fill (when it is a real colour), else the most saturated common colour
  const saturated = [...bg.top(20), ...text.top(10)].map((x) => x.value).filter((c) => saturation(c) > 0.35 && luminance(c) > 0.02 && luminance(c) < 0.9);
  let primary = btnBg.top(1)[0]?.value;
  if (!primary || distance(primary, background) < 30) primary = saturated[0] || link.top(1)[0]?.value || foreground;
  const accent = saturated.find((c) => distance(c, primary) > 50) || link.top(1)[0]?.value || primary;
  const onPrimary = btnText.top(1)[0]?.value && contrast(btnText.top(1)[0].value, primary) >= 3 ? btnText.top(1)[0].value : (contrast('#ffffff', primary) >= contrast('#000000', primary) ? '#ffffff' : '#000000');
  const line = border.top(3).map((x) => x.value).find((c) => distance(c, background) > 8) || mix(background, dark ? '#ffffff' : '#000000', 0.12);
  const palette = [...new Set([background, foreground, surface, surface2, muted, primary, accent, line, ...bg.top(8).map((x) => x.value)])].filter((c) => parseColor(c)).slice(0, 14);
  return { background, surface, surface2, foreground, muted, primary, onPrimary, accent, line, link: link.top(1)[0]?.value || accent, dark, palette };
}

function pickLayout(pages) {
  const container = tally(); const padY = tally(); const padX = tally(); const gaps = tally(); const cols = tally(); const maxW = tally();
  const bps = new Set();
  pages.forEach((page) => {
    const m = page.desktop; if (!m) return;
    if (m.grid?.contentWidth) container.add(m.grid.contentWidth, 2);
    (m.grid?.maxWidths || []).forEach((w) => { const n = px(w.value); if (n && n > 480) maxW.add(n, w.count); });
    (m.grid?.columns || []).forEach((c) => cols.add(Number(c.value), c.count));
    (m.spacing?.sectionPaddingY || []).forEach((c) => padY.add(px(c.value), c.count));
    (m.spacing?.sectionPaddingX || []).forEach((c) => padX.add(px(c.value), c.count));
    (m.spacing?.gaps || []).forEach((c) => gaps.add(px(String(c.value).split(' ')[0]), c.count));
    (m.breakpoints || []).forEach((b) => bps.add(b));
  });
  const containerWidth = maxW.top(1)[0]?.value || container.top(1)[0]?.value || 1200;
  const spacingValues = [...padY.top(6), ...gaps.top(8)].map((x) => x.value).filter((v) => v && v >= 4).sort((a, b) => a - b);
  const base = (() => { const small = spacingValues.filter((v) => v <= 32); if (!small.length) return 8; const g = small.reduce((a, b) => { while (b) { [a, b] = [b, a % b]; } return a; }); return g >= 4 ? Math.min(g, 8) : 8; })();
  const widths = [...bps].map((b) => ({ raw: b, kind: b.startsWith('min') ? 'min' : 'max', value: px(b.split(':')[1]) })).filter((b) => b.value);
  const points = [...new Set(widths.map((b) => b.value))].sort((a, b) => a - b);
  return {
    containerWidth: round(containerWidth, 8), sectionPaddingY: padY.top(3).map((x) => x.value), sectionPaddingX: padX.top(2).map((x) => x.value), gaps: gaps.top(5).map((x) => x.value),
    gridColumns: cols.top(4).map((x) => x.value), spacingBase: base, breakpoints: points.slice(0, 8)
  };
}

function pickEffects(pages) {
  const radius = tally(); const shadow = tally(); const gradient = tally();
  pages.forEach((page) => { const m = page.desktop; if (!m) return; (m.radii || []).forEach((r) => radius.add(r.value, r.count)); (m.shadows || []).forEach((s) => shadow.add(s.value, s.count)); (m.gradients || []).forEach((g) => gradient.add(g.value, g.count)); });
  const radii = radius.top(8).map((r) => ({ value: r.value, px: px(r.value), count: r.count })).filter((r) => r.px !== null).sort((a, b) => a.px - b.px);
  const unique = [...new Map(radii.map((r) => [r.px, r])).values()];
  const pick = (target) => unique.reduce((best, r) => (!best || Math.abs(r.px - target) < Math.abs(best.px - target) ? r : best), null);
  const pill = unique.find((r) => r.px >= 100) || null;
  const rest = unique.filter((r) => r.px < 100);
  return {
    radius: { sm: (rest[0] || pick(4) || { value: '4px' }).value, md: (rest[Math.floor(rest.length / 2)] || pick(8) || { value: '8px' }).value, lg: (rest[rest.length - 1] || pick(16) || { value: '16px' }).value, pill: pill ? '9999px' : null, all: unique.map((r) => r.value) },
    shadows: shadow.top(4).map((x) => x.value), gradients: gradient.top(5).map((x) => x.value)
  };
}

/** Builds the design-system manifest. `pages` are crawler results (each with .desktop and .mobile metrics). */
async function buildDesignSystem(pages, { source = {}, getCatalogue } = {}) {
  const captured = (pages || []).filter((p) => p && p.desktop);
  if (!captured.length) return { ok: false, reason: 'no-captured-pages', message: 'No page was measured, so no design system could be extracted.' };
  const typography = pickTypography(captured);
  const fonts = await resolveFonts(typography, { getCatalogue });
  const colors = pickColors(captured);
  const layout = pickLayout(captured);
  const effects = pickEffects(captured);
  const buttons = (() => { const t = tally(); const samples = new Map(); captured.forEach((p) => { const b = p.desktop.buttons; if (b) { const k = JSON.stringify(b); t.add(k); samples.set(k, b); } }); const best = t.top(1)[0]; return best ? samples.get(best.value) : null; })();
  const cards = (() => { const t = tally(); const samples = new Map(); captured.forEach((p) => { const c = p.desktop.cards; if (c) { const k = JSON.stringify(c); t.add(k); samples.set(k, c); } }); const best = t.top(1)[0]; return best ? samples.get(best.value) : null; })();
  return {
    ok: true, version: 1, builtAt: new Date().toISOString(),
    source: { ...source, pagesMeasured: captured.length, viewports: { desktop: captured[0].desktop.viewport, mobile: captured.find((p) => p.mobile)?.mobile?.viewport || null } },
    fonts, typography, colors, layout, radius: effects.radius, shadows: effects.shadows, gradients: effects.gradients, buttons, cards,
    evidence: { typographyRoles: Object.keys(typography), missingRoles: ROLES.filter((r) => !typography[r]), hasMobile: captured.some((p) => p.mobile) }
  };
}

const css = (n) => (n === null || n === undefined ? null : `${Number(n.toFixed ? n.toFixed(2) : n)}`.replace(/\.00$/, ''));

/** Files that make the design system real in the generated project: CSS variables, Tailwind theme, font link. */
function renderThemeFiles(ds, files = []) {
  const c = ds.colors;
  const ch = (color, fallback) => channels(color) || channels(fallback) || '0 0 0';
  const stackOf = (record, fallback) => {
    if (!record) return fallback;
    const parts = [];
    if (record.google) parts.push(`'${record.google}'`); else if (record.original && !/^["']?(serif|sans-serif|monospace)["']?$/i.test(record.original)) parts.push(`'${record.original}'`);
    parts.push(record.fallback === 'serif' ? 'Georgia, serif' : 'system-ui, -apple-system, Segoe UI, sans-serif');
    return parts.join(', ');
  };
  const heading = stackOf(ds.fonts.heading, 'system-ui, sans-serif');
  const body = stackOf(ds.fonts.body, 'system-ui, sans-serif');
  const t = ds.typography;
  const type = (role, fallbackSize) => t[role] ? t[role] : { size: fallbackSize, sizeMobile: fallbackSize, weight: 400, lineHeight: 1.5, letterSpacing: 0, textTransform: 'none', color: null };
  const h = (n, size) => { const r = type(`h${n}`, size); return `h${n}{font-family:var(--font-heading);font-weight:${r.weight};font-size:${r.sizeMobile}px;line-height:${r.lineHeight};letter-spacing:${r.letterSpacing}px;text-transform:${r.textTransform};}\n@media (min-width:768px){h${n}{font-size:${r.size}px;}}`; };
  const bodyType = type('p', 16);
  const css0 = `/* Design system extracted from the reference website (measured computed styles). Edit the variables to restyle the whole site. */
:root {
  --bg: ${ch(c.background, '#ffffff')};
  --surface: ${ch(c.surface, c.background)};
  --surface-2: ${ch(c.surface2, c.surface)};
  --line: ${ch(c.line, '#e5e5e5')};
  --fg: ${ch(c.foreground, '#111111')};
  --muted: ${ch(c.muted, c.foreground)};
  --brand: ${ch(c.primary, c.foreground)};
  --on-brand: ${ch(c.onPrimary, '#ffffff')};
  --accent: ${ch(c.accent, c.primary)};
  --font-heading: ${heading};
  --font-body: ${body};
  --container: ${ds.layout.containerWidth}px;
  --radius-sm: ${ds.radius.sm};
  --radius-md: ${ds.radius.md};
  --radius-lg: ${ds.radius.lg};
  --radius-pill: ${ds.radius.pill || ds.radius.lg};
  --section-y: ${(ds.layout.sectionPaddingY[0] || 64)}px;
}
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-weight: ${bodyType.weight};
  font-size: ${bodyType.size || 16}px;
  line-height: ${bodyType.lineHeight};
  background-color: rgb(var(--bg));
  color: rgb(var(--fg));
}
${h(1, 48)}
${h(2, 36)}
${h(3, 24)}
${h(4, 20)}
`;
  const tailwind = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        brand: { 500: 'rgb(var(--brand) / <alpha-value>)', 600: 'rgb(var(--brand) / <alpha-value>)' }
      },
      fontFamily: { sans: ['var(--font-body)'], heading: ['var(--font-heading)'] },
      borderRadius: { token: 'var(--radius-md)', 'token-sm': 'var(--radius-sm)', 'token-lg': 'var(--radius-lg)', 'token-pill': 'var(--radius-pill)' },
      maxWidth: { container: 'var(--container)' }${ds.layout.breakpoints.length ? `,\n      screens: { ${ds.layout.breakpoints.filter((b) => b >= 480 && b <= 1920).slice(0, 5).map((b, i) => `'bp${i + 1}': '${b}px'`).join(', ')} }` : ''}
    }
  },
  plugins: []
};
`;
  const families = [...new Set([ds.fonts.heading?.google, ds.fonts.body?.google, ds.fonts.button?.google].filter(Boolean))];
  const weights = [...new Set([300, 400, 500, 600, 700, 800, ...Object.values(t).map((r) => r.weight)])].filter((w) => w >= 100 && w <= 900).sort((a, b) => a - b);
  const fontLink = families.length ? `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replace(/ /g, '+')}:wght@${weights.join(';')}`).join('&')}&display=swap" rel="stylesheet" />` : '';
  const out = new Map(files.map((f) => [f.path, f]));
  out.set('src/index.css', { path: 'src/index.css', language: 'css', content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${css0}` });
  out.set('tailwind.config.js', { path: 'tailwind.config.js', language: 'javascript', content: tailwind });
  const html = out.get('index.html');
  if (html && fontLink && !html.content.includes('fonts.googleapis.com/css2')) out.set('index.html', { ...html, content: html.content.replace(/<\/head>/i, `    ${fontLink}\n  </head>`) });
  return [...out.values()];
}

module.exports = { familyVariants, buildDesignSystem, renderThemeFiles, pickTypography, pickColors, pickLayout, pickEffects, resolveFonts, firstFamily };
