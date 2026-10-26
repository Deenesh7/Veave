/**
 * Pages rebuilt from a captured website keep the page's HTML as ONE JSON string on ONE line:
 *
 *     const html = "\n    <div id=\"siteWrapper\" ...>\n ... (hundreds of KB) ...";
 *
 * A model cannot edit that with SEARCH/REPLACE: it reads real markup with real line breaks, but the file holds `\n` and `\"`
 * escapes on a single line, so no SEARCH block can ever match. This module gives the editor a readable VIEW of the HTML
 * (unescaped, one tag per line, blank lines and indentation collapsed) and applies the patch to the HTML itself, ignoring
 * whitespace differences, then writes it back as the same JSON string. The stored file keeps its format.
 */

const ASSIGN = /^(const html = )("(?:[^"\\\n]|\\[\s\S])*")(;[ \t]*)$/m;

function parse(content) {
  const text = String(content || '');
  if (!text.includes('dangerouslySetInnerHTML') || !text.includes('const html = ')) return null;
  const match = ASSIGN.exec(text);
  if (!match) return null;
  let html;
  try { html = JSON.parse(match[2]); } catch { return null; }
  if (typeof html !== 'string') return null;
  const start = match.index + match[1].length;
  return { html, start, end: start + match[2].length };
}

/** Whitespace runs that contain a line break become one line break, so the view is short and has one element per line. */
const collapse = (html) => html.replace(/[ \t\r]*\n[\s]*/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');

/** What the model reads: the file with its HTML shown as plain, line-broken markup inside a template literal. */
function viewOf(content) {
  const p = parse(content);
  if (!p) return content;
  return `${content.slice(0, p.start)}\`\n${collapse(p.html)}\n\`${content.slice(p.end)}`;
}

// Whitespace-insensitive text with a map back to positions in the original string.
function squash(text) {
  let out = '';
  const map = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) {
      if (!lastSpace) { out += ' '; map.push(i); lastSpace = true; }
    } else { out += text[i]; map.push(i); lastSpace = false; }
  }
  if (out.endsWith(' ')) { out = out.slice(0, -1); map.pop(); }
  return { out, map };
}

/**
 * Applies one SEARCH/REPLACE to the HTML of a captured-page file.
 * @returns {null | {content:string} | {matches:number}}  null: this file/patch is not about the captured HTML (use the normal path);
 *   {matches:0|n>1}: the block is not unique in the HTML.
 */
function applyPatch(content, search, replace) {
  const p = parse(content);
  if (!p) return null;
  const wanted = squash(String(search || '').replace(/^\s*`\s*\n?/, '').replace(/\n?\s*`\s*$/, '')).out; // the view's own wrapper backticks are not HTML
  if (wanted.length < 4) return null;
  const { out, map } = squash(p.html);
  const hits = [];
  for (let at = out.indexOf(wanted); at !== -1; at = out.indexOf(wanted, at + 1)) hits.push(at);
  if (hits.length !== 1) return hits.length ? { matches: hits.length } : null; // 0 hits: the block may be in the JS around the HTML
  const from = map[hits[0]];
  const to = map[hits[0] + wanted.length - 1] + 1;
  const next = p.html.slice(0, from) + String(replace ?? '') + p.html.slice(to);
  return { content: `${content.slice(0, p.start)}${JSON.stringify(next)}${content.slice(p.end)}` };
}

module.exports = { parse, viewOf, applyPatch, collapse };
