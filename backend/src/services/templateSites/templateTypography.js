/**
 * Typography theme of a template site: one curated font library, presets, validation, and the deterministic step that writes the
 * chosen typography into the site's own theme files (the managed block at the end of src/index.css and the font <link> in index.html).
 * Pages are never touched, so layout, content, routes and images stay exactly as they were; every page inherits the same fonts.
 * The settings are also embedded in the CSS block, so a restored website version carries its own typography with it.
 */
const { ValidationError } = require('../../utils/errors');

// Every family here is served by Google Fonts (the font provider the generated sites load), with the weights it really has.
const FONTS = [
  { name: 'Inter', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Roboto', kind: 'sans', weights: [300, 400, 500, 700, 900] },
  { name: 'Poppins', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Montserrat', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Lato', kind: 'sans', weights: [300, 400, 700, 900] },
  { name: 'Open Sans', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Nunito', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Playfair Display', kind: 'serif', weights: [400, 500, 600, 700, 800] },
  { name: 'Merriweather', kind: 'serif', weights: [300, 400, 700, 900] },
  { name: 'Lora', kind: 'serif', weights: [400, 500, 600, 700] },
  { name: 'DM Sans', kind: 'sans', weights: [300, 400, 500, 600, 700] },
  { name: 'DM Serif Display', kind: 'serif', weights: [400] },
  { name: 'Space Grotesk', kind: 'sans', weights: [300, 400, 500, 600, 700] },
  { name: 'Outfit', kind: 'sans', weights: [300, 400, 500, 600, 700, 800] },
  { name: 'Source Sans 3', kind: 'sans', weights: [300, 400, 600, 700, 900] }
];
const BY_NAME = new Map(FONTS.map((font) => [font.name, font]));

const FALLBACK = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
};

const PRESETS = [
  { id: 'modern', name: 'Modern', headingFont: 'Inter', bodyFont: 'Inter', headingWeight: 700, bodyWeight: 400, headingLetterSpacing: -0.02, bodyLineHeight: 1.6 },
  { id: 'elegant', name: 'Elegant', headingFont: 'Playfair Display', bodyFont: 'Lato', headingWeight: 600, bodyWeight: 400, headingLetterSpacing: 0, bodyLineHeight: 1.7 },
  { id: 'editorial', name: 'Editorial', headingFont: 'Lora', bodyFont: 'DM Sans', headingWeight: 600, bodyWeight: 400, headingLetterSpacing: -0.01, bodyLineHeight: 1.65 },
  { id: 'corporate', name: 'Corporate', headingFont: 'Montserrat', bodyFont: 'Open Sans', headingWeight: 700, bodyWeight: 400, headingLetterSpacing: -0.01, bodyLineHeight: 1.6 },
  { id: 'minimal', name: 'Minimal', headingFont: 'DM Sans', bodyFont: 'DM Sans', headingWeight: 500, bodyWeight: 400, headingLetterSpacing: -0.02, bodyLineHeight: 1.6 },
  { id: 'creative', name: 'Creative', headingFont: 'Space Grotesk', bodyFont: 'Inter', headingWeight: 700, bodyWeight: 400, headingLetterSpacing: -0.02, bodyLineHeight: 1.6 },
  { id: 'classic', name: 'Classic', headingFont: 'Merriweather', bodyFont: 'Lato', headingWeight: 700, bodyWeight: 400, headingLetterSpacing: 0, bodyLineHeight: 1.7 }
];

const LIMITS = {
  headingSize: [0.8, 1.3, 1], // multiple of the template's heading size
  headingLetterSpacing: [-0.05, 0.1, 0], // em
  bodySize: [14, 20, 16], // px
  bodyLineHeight: [1.3, 2, 1.6]
};


const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
const num = (value, [min, max, fallback]) => {
  const parsed = Number(value);
  if (value === undefined || value === null || value === '' || Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed * 1000) / 1000));
};

/**
 * Validates a typography object from a request. Returns null when nothing is customised (the template's own typography stays).
 * An empty font name means "keep the template's own font for this role".
 */
function normalize(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('typography must be an object.');
  const out = {};
  for (const role of ['heading', 'body']) {
    const name = input[`${role}Font`];
    if (name && !BY_NAME.has(name)) throw new ValidationError(`"${String(name).slice(0, 40)}" is not an available font.`);
    out[`${role}Font`] = name || '';
    const font = BY_NAME.get(name);
    const wanted = Number(input[`${role}Weight`]) || (role === 'heading' ? 700 : 400);
    out[`${role}Weight`] = nearest(font ? font.weights : [300, 400, 500, 600, 700, 800], wanted);
  }
  out.headingSize = num(input.headingSize, LIMITS.headingSize);
  out.headingLetterSpacing = num(input.headingLetterSpacing, LIMITS.headingLetterSpacing);
  out.bodySize = num(input.bodySize, LIMITS.bodySize);
  out.bodyLineHeight = num(input.bodyLineHeight, LIMITS.bodyLineHeight);
  const untouched = !out.headingFont && !out.bodyFont && out.headingSize === 1 && out.headingLetterSpacing === 0 && out.bodySize === 16 && out.bodyLineHeight === 1.6
    && out.headingWeight === 700 && out.bodyWeight === 400;
  return untouched ? null : out;
}

const stack = (name, templateStack, kind) => (name ? `'${name}', ${FALLBACK[BY_NAME.get(name)?.kind || kind]}` : templateStack);

/** The Google Fonts stylesheet URL that serves exactly the families and weights in use. */
function fontsUrl(typography) {
  const wanted = new Map();
  for (const role of ['heading', 'body']) {
    const name = typography[`${role}Font`];
    if (!name) continue;
    wanted.set(name, new Set([...(wanted.get(name) || []), typography[`${role}Weight`], 400, 700].filter((weight) => BY_NAME.get(name).weights.includes(weight))));
  }
  if (!wanted.size) return null;
  const families = [...wanted].map(([name, weights]) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${[...weights].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/** The CSS for the typography. Only font and text-rhythm properties; nothing about layout, colour or structure. */
function typographyCss(t, template) {
  if (!t) return '';
  const headingStack = stack(t.headingFont, template?.typography?.headingFont || FALLBACK.serif, 'serif');
  const bodyStack = stack(t.bodyFont, template?.typography?.bodyFont || FALLBACK.sans, 'sans');
  const lines = [];
  if (t.bodySize !== 16) lines.push(`html { font-size: ${t.bodySize}px; }`);
  lines.push(`body, .font-sans { font-family: ${bodyStack}; font-weight: ${t.bodyWeight}; line-height: ${t.bodyLineHeight}; }`);
  lines.push(`h1, h2, h3, h4, h5, h6, .font-heading, .font-serif { font-family: ${headingStack}; font-weight: ${t.headingWeight}; letter-spacing: ${t.headingLetterSpacing}em; overflow-wrap: break-word; }`);
  if (t.headingSize !== 1) lines.push(`h1, h2, h3 { zoom: ${t.headingSize}; }`);
  lines.push('button, input, select, textarea, a { font-family: inherit; }');
  return lines.join('\n');
}

const library = () => ({ fonts: FONTS.map((font) => ({ ...font, fallback: FALLBACK[font.kind] })), presets: PRESETS, limits: LIMITS, googleFontsUrl: `https://fonts.googleapis.com/css2?${FONTS.map((font) => `family=${encodeURIComponent(font.name).replace(/%20/g, '+')}:wght@${font.weights.join(';')}`).join('&')}&display=swap` });

module.exports = { FONTS, PRESETS, LIMITS, normalize, typographyCss, fontsUrl, library };
