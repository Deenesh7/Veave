/**
 * The theme of a template site: typography, colours and appearance, chosen before the site is created.
 *
 * One mechanism for everything:
 *   - the colours use the template's own design tokens (the RGB-channel CSS variables of src/index.css that every component reads);
 *   - typography and appearance are CSS rules in one managed block at the end of src/index.css, plus the font <link> in index.html;
 *   - the same CSS string (`cssFor`) is what the New Site preview injects into the compiled template and what is written into the
 *     site's files, so the preview and the created website cannot disagree.
 * Pages, navigation, images and routes are never touched. The whole theme is embedded in the block, so a restored website version
 * carries its theme with it.
 */
const { ValidationError } = require('../../utils/errors');
const typo = require('./templateTypography');

const START = '/* veave:theme:start';
const END = '/* veave:theme:end */';
const MARKER_BLOCK = /\n?\/\* veave:theme:start [\s\S]*?\/\* veave:theme:end \*\//;
const LINK_TAG = /\s*<link[^>]*data-veave-typography[^>]*>/g;
const PRECONNECT = /\s*<link[^>]*data-veave-fonts-preconnect[^>]*>/g;

// The theme palette. Each role is one of the template's own design tokens: primary -> brand (buttons, links, marks),
// secondary -> surface-2 (alternate bands, the footer), accent -> focus/selection/plain links, background -> bg, surface -> cards,
// text -> fg, textSecondary -> muted, border -> line.
const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'textSecondary', 'border'];

const palette = (id, name, [primary, secondary, accent, background, surface, text, textSecondary, border]) => ({ id, name, colors: { primary, secondary, accent, background, surface, text, textSecondary, border } });
const PALETTES = [
  palette('minimal-neutral', 'Minimal Neutral', ['#222222', '#EFEFEA', '#8A8A84', '#FFFFFF', '#F7F7F5', '#1A1A1A', '#6B6B66', '#E2E2DC']),
  palette('ocean-blue', 'Ocean Blue', ['#1D5FD0', '#E3EEFB', '#00A6A6', '#F4F8FC', '#FFFFFF', '#10233B', '#5B6B80', '#D5E1F0']),
  palette('forest-green', 'Forest Green', ['#2F6B3F', '#E6EFE4', '#B58A2E', '#F6F8F3', '#FFFFFF', '#1B2B20', '#5F6F63', '#D6E0D3']),
  palette('warm-earth', 'Warm Earth', ['#B5532A', '#F1E6D8', '#C79A3B', '#FAF5EE', '#FFFFFF', '#2E2218', '#7A6A58', '#E6D8C6']),
  palette('modern-purple', 'Modern Purple', ['#6D3FD6', '#EEE8FB', '#E0568A', '#FAF8FE', '#FFFFFF', '#1F1634', '#6A6080', '#E0D8F2']),
  palette('creative-colorful', 'Creative Colorful', ['#E5484D', '#FFF0C9', '#2A9D8F', '#FFFDF7', '#FFFFFF', '#22223B', '#5C5C78', '#F0E2B6']),
  palette('professional-corporate', 'Professional Corporate', ['#0B4F8A', '#E9EEF4', '#C8102E', '#FFFFFF', '#F5F7FA', '#14202E', '#566474', '#D8DFE8']),
  palette('dark-mode', 'Dark Mode', ['#7C9CFF', '#1E2338', '#F5B94A', '#0F1220', '#171B2E', '#EEF0F8', '#A3ABC0', '#2A3050'])
];

const BUTTON_STYLES = { pill: '999px', rounded: '10px', square: '0px' };
const RADII = { none: '0px', small: '4px', medium: '10px', large: '18px' };
const SPACING = { compact: '3rem', default: null, spacious: '7rem' };
const WIDTHS = { narrow: '56rem', default: null, wide: '80rem' };

/* ---------------------------------- colour maths ---------------------------------- */

const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hexOf = (rgb) => `#${rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const mix = (a, b, amount) => { const x = rgbOf(a); const y = rgbOf(b); return hexOf(x.map((value, index) => value + (y[index] - value) * amount)); };
const luminance = (hex) => {
  const [r, g, b] = rgbOf(hex).map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const readable = (background) => (contrast('#FFFFFF', background) >= contrast('#111111', background) ? '#FFFFFF' : '#111111');
const channels = (hex) => rgbOf(hex).join(' ');

/** Validates the colours and keeps the text readable: text 4.5:1 on the background, secondary text 3:1. Returns { colors|null, adjusted[] }. */
function normalizeColors(input) {
  if (input === undefined || input === null) return { colors: null, adjusted: [] };
  if (typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('colors must be an object.');
  const colors = {};
  for (const key of COLOR_KEYS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (!HEX.test(String(input[key]))) throw new ValidationError(`The ${key} colour must look like #RRGGBB.`);
    colors[key] = String(input[key]).toUpperCase();
  }
  return { colors: Object.keys(colors).length ? colors : null, adjusted: [] };
}

/** The colours as the template's tokens, complete and readable, given the template's own defaults for what was not chosen. */
function resolveColors(colors, template) {
  const base = template?.designTokens?.colors || {};
  if (!colors) return { vars: null };
  const background = colors.background || base.bg;
  let text = colors.text || base.fg;
  if (contrast(text, background) < 4.5) text = readable(background);
  let textSecondary = colors.textSecondary || base.muted;
  if (contrast(textSecondary, background) < 3) textSecondary = mix(text, background, 0.35);
  const surface = colors.surface || (colors.background ? mix(background, text, 0.04) : base.surface);
  const brand = colors.primary || base.brand;
  const touchedBase = Boolean(colors.background || colors.surface || colors.text);
  const vars = {
    '--bg': channels(background),
    '--surface': channels(surface),
    '--fg': channels(text),
    '--muted': channels(textSecondary),
    '--brand': channels(brand),
    '--on-brand': channels(readable(brand)),
    '--accent': channels(colors.accent || base.accent || brand)
  };
  if (colors.secondary || touchedBase) vars['--surface-2'] = channels(colors.secondary || mix(surface, text, 0.07));
  if (colors.border || touchedBase) vars['--line'] = channels(colors.border || mix(background, text, 0.15));
  return { vars };
}

/* ---------------------------------- normalise ---------------------------------- */

/**
 * Validates a theme from a request: { typography?, colors?, appearance? }. Returns { theme: object|null, adjusted: string[] };
 * null means nothing was customised (the template stays exactly as it is). Text colours are corrected for contrast.
 */
function normalize(input, template = null) {
  if (input === undefined || input === null) return { theme: null, adjusted: [] };
  if (typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('theme must be an object.');
  const typography = typo.normalize(input.typography);
  const parsed = normalizeColors(input.colors);
  let colors = parsed.colors;
  let adjusted = [];
  if (colors) {
    // Store the corrected values, so what is saved is what is shown.
    const base = template?.designTokens?.colors || {};
    const background = colors.background || base.bg;
    const text = colors.text || base.fg;
    if (background && text && (colors.text || colors.background) && contrast(text, background) < 4.5) { colors = { ...colors, text: readable(background) }; adjusted.push('text'); }
    const second = colors.textSecondary || base.muted;
    if (background && second && (colors.textSecondary || colors.background) && contrast(second, background) < 3) { colors = { ...colors, textSecondary: mix(colors.text || base.fg, background, 0.35) }; adjusted.push('textSecondary'); }
  }
  let appearance = null;
  if (input.appearance !== undefined && input.appearance !== null) {
    const a = input.appearance;
    if (typeof a !== 'object' || Array.isArray(a)) throw new ValidationError('appearance must be an object.');
    const pick = (key, table) => { if (a[key] === undefined || a[key] === null || a[key] === '' || a[key] === 'default') return undefined; if (!(a[key] in table)) throw new ValidationError(`${key} must be one of: ${Object.keys(table).join(', ')}.`); return a[key]; };
    const next = { buttonStyle: pick('buttonStyle', BUTTON_STYLES), radius: pick('radius', RADII), sectionSpacing: pick('sectionSpacing', SPACING), containerWidth: pick('containerWidth', WIDTHS) };
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === 'default') delete next[key];
    appearance = Object.keys(next).length ? next : null;
  }
  const theme = { ...(typography ? { typography } : {}), ...(colors ? { colors } : {}), ...(appearance ? { appearance } : {}) };
  return { theme: Object.keys(theme).length ? theme : null, adjusted };
}

/* ---------------------------------- CSS ---------------------------------- */

/** The complete theme CSS (no markers). Empty when nothing is customised. */
function cssFor(theme, template) {
  if (!theme) return '';
  const parts = [];
  const { vars } = resolveColors(theme.colors, template);
  const root = { ...(vars || {}) };
  const a = theme.appearance || {};
  if (a.buttonStyle) root['--radius-button'] = BUTTON_STYLES[a.buttonStyle];
  if (a.radius) root['--radius-card'] = RADII[a.radius];
  if (Object.keys(root).length) parts.push(`:root {\n${Object.entries(root).map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`);
  if (vars) {
    // Buttons and links follow the primary colour (brand); the accent colour marks selection, focus and plain links.
    parts.push('::selection { background: rgb(var(--accent) / 0.3); }\n:focus-visible { outline-color: rgb(var(--accent)); }\np a:not([class]) { color: rgb(var(--accent)); }');
  }
  if (a.sectionSpacing && SPACING[a.sectionSpacing]) parts.push(`section[class*="py-"] { padding-top: ${SPACING[a.sectionSpacing]} !important; padding-bottom: ${SPACING[a.sectionSpacing]} !important; }`);
  if (a.containerWidth && WIDTHS[a.containerWidth]) parts.push(`.mx-auto.w-full[class*="max-w-"] { max-width: ${WIDTHS[a.containerWidth]} !important; }`);
  if (theme.typography) parts.push(typo.typographyCss(theme.typography, template));
  return parts.join('\n');
}

/** What the live preview injects: the fonts import first (CSS requires @import before rules), then the theme. */
function previewCss(theme, template) {
  const url = theme?.typography ? typo.fontsUrl(theme.typography) : null;
  return `${url ? `@import url('${url}');\n` : ''}${cssFor(theme, template)}`;
}

/* ---------------------------------- files ---------------------------------- */

const strip = (files) => files.map((file) => {
  if (file.path === 'src/index.css') return { ...file, content: file.content.replace(MARKER_BLOCK, '').replace(/\s+$/, '\n') };
  if (file.path === 'index.html') return { ...file, content: file.content.replace(LINK_TAG, '').replace(PRECONNECT, '') };
  return file;
});

/** Writes the theme into the site's files (src/index.css block, font link in index.html). Pure; replaces any earlier theme; null removes it. */
function applyTheme(files, theme, template) {
  const base = strip(files);
  if (!theme) return base;
  const css = `${START} ${JSON.stringify(theme)} */\n${cssFor(theme, template)}\n${END}`;
  const url = theme.typography ? typo.fontsUrl(theme.typography) : null;
  return base.map((file) => {
    if (file.path === 'src/index.css') return { ...file, content: `${file.content.replace(/\s+$/, '')}\n\n${css}\n` };
    if (file.path === 'index.html' && url) {
      const tags = `    <link rel="preconnect" href="https://fonts.googleapis.com" data-veave-fonts-preconnect />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin data-veave-fonts-preconnect />\n    <link rel="stylesheet" href="${url}" data-veave-typography />\n`;
      return { ...file, content: file.content.replace(/\s*<\/head>/, `\n${tags}  </head>`) };
    }
    return file;
  });
}

/** Reads the theme back out of a site's files (null when it has none). Used after a version restore. */
function readTheme(files) {
  const css = (files || []).find((file) => file.path === 'src/index.css');
  const at = css && typeof css.content === 'string' ? css.content.indexOf(`${START} `) : -1;
  if (at < 0) return null;
  const end = css.content.indexOf(' */', at);
  try { return normalize(JSON.parse(css.content.slice(at + START.length + 1, end))).theme; } catch { return null; }
}

const defaultsOf = (template) => {
  const c = template.designTokens.colors;
  return { colors: { primary: c.brand, secondary: c.surface2, accent: c.accent || c.brand, background: c.bg, surface: c.surface, text: c.fg, textSecondary: c.muted, border: c.line }, radius: template.designTokens.radius };
};

const library = () => ({ ...typo.library(), palettes: PALETTES, appearance: { buttonStyle: ['default', ...Object.keys(BUTTON_STYLES)], radius: ['default', ...Object.keys(RADII)], sectionSpacing: Object.keys(SPACING), containerWidth: Object.keys(WIDTHS) } });

module.exports = { PALETTES, COLOR_KEYS, normalize, cssFor, previewCss, applyTheme, readTheme, defaultsOf, library, contrast };
