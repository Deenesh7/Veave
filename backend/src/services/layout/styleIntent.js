// Understands "make the footer background black and the text white" without a model call (a model can be used as a fallback).
const NAMED = { black: '#000000', white: '#ffffff', red: '#dc2626', green: '#16a34a', blue: '#2563eb', yellow: '#facc15', orange: '#f97316', purple: '#9333ea', pink: '#ec4899', gray: '#6b7280', grey: '#6b7280', navy: '#0a1f44', teal: '#0d9488', brown: '#78350f', gold: '#d4af37', maroon: '#7f1d1d', beige: '#f5f5dc', cream: '#fffdd0' };
const COLOR = `(#[0-9a-f]{3,8}\\b|${Object.keys(NAMED).join('|')}|dark\\s+(?:blue|gray|grey|green|red)|light\\s+(?:blue|gray|grey|green))`;
const TARGETS = [['footer', /\bfooter\b/i], ['header', /\bheader\b/i], ['nav', /\b(?:navbar|nav\s*bar|navigation|nav)\b/i], ['hero', /\bhero\b/i], ['banner', /\bbanner\b/i], ['sidebar', /\bsidebar\b/i], ['menu', /\bmenu\b/i]];

function toHex(value) {
  const v = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (NAMED[v]) return NAMED[v];
  const m = v.match(/^(dark|light)\s+(\w+)$/);
  if (m && NAMED[m[2]]) {
    const n = parseInt(NAMED[m[2]].slice(1), 16);
    const f = m[1] === 'dark' ? 0.55 : 1.6;
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(m[1] === 'dark' ? c * f : c + (255 - c) * 0.5))));
    return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** @returns { target, background, color } or null when the request is not a simple restyle of a named page region. */
const normalize = (request) => String(request)
  .replace(/\bback\s*-?\s*gr?ou?n?d\b/gi, 'background').replace(/\bbackgr?ou?nd\b/gi, 'background').replace(/\bbg\s*colou?r\b/gi, 'background')
  .replace(/\bfont\s*colou?r\b/gi, 'text').replace(/\b(?:text|font)\s*colou?r\b/gi, 'text');

function parseStyleRequest(request = '') {
  const text = normalize(request);
  const target = (TARGETS.find(([, re]) => re.test(text)) || [])[0];
  if (!target) return null;
  const grab = (res) => { for (const re of res) { const m = text.match(re); if (m) { const hex = toHex(m[1]); if (hex) return hex; } } return null; };
  const background = grab([new RegExp(`\\b(?:background|bg)(?:\\s*colou?r)?\\s*(?:to|as|=|:|be|is|into)?\\s*(?:a\\s+|the\\s+)?${COLOR}`, 'i'), new RegExp(`${COLOR}\\s+(?:background|bg)\\b`, 'i')]);
  const color = grab([new RegExp(`\\b(?:text|font|writing|letters?)(?:\\s*colou?r)?\\s*(?:to|as|=|:|be|is|into)?\\s*(?:a\\s+|the\\s+)?${COLOR}`, 'i'), new RegExp(`${COLOR}\\s+(?:text|font)\\b`, 'i')]);
  if (!background && !color) return null;
  return { target, background, color };
}

const colorWords = (request) => (String(request).match(new RegExp(COLOR, 'gi')) || []).length;

/**
 * Rule-based first; when the wording is unusual (typos, odd phrasing) and the rules found only part of what the request
 * mentions, `ask(messages)` (a model) reads the request into the same structure. The model never edits anything.
 */
async function interpretStyleRequest(request = '', ask = null) {
  const rules = parseStyleRequest(request);
  const mentionsTarget = TARGETS.some(([, re]) => re.test(request));
  const colors = colorWords(normalize(request));
  const complete = rules && (rules.background && rules.color || colors <= 1);
  if (complete || !ask || !mentionsTarget || colors < 1) return rules;
  try {
    const completion = await ask([
      { role: 'system', content: 'Read a website edit request that changes COLOURS of one named page region. Reply with JSON only: {"target":"footer|header|nav|hero|banner|sidebar|menu","background":"#rrggbb or null","color":"#rrggbb or null"} where background is the region background and color is its text colour. Use null for anything the request does not ask for. If the request is not a colour change of such a region reply {"target":null}.' },
      { role: 'user', content: String(request).slice(0, 600) }
    ]);
    const parsed = JSON.parse(String(completion?.content || '{}').match(/\{[\s\S]*\}/)?.[0] || '{}');
    const target = TARGETS.map(([name]) => name).includes(parsed.target) ? parsed.target : null;
    const background = parsed.background ? toHex(parsed.background) : null; const color = parsed.color ? toHex(parsed.color) : null;
    return target && (background || color) ? { target, background, color } : rules;
  } catch { return rules; }
}

module.exports = { parseStyleRequest, interpretStyleRequest, toHex, rgbOf, NAMED };
