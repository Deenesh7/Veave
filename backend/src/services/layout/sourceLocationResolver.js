// Maps a rendered element back to the source that styles it, by repository-level tracing of class names, inline styles and
// stylesheet rules (the preview compiler does not expose per-element source positions). It never assumes a file: every
// location is found by matching what the browser reported against the project text.
const textFile = (file) => file && file.encoding !== 'base64' && typeof file.content === 'string';
const isMarkup = (file) => /\.(?:jsx?|tsx?|html?)$/i.test(file.path || '');
const isCss = (file) => /\.(?:css|scss|less)$/i.test(file.path || '');
const splitClasses = (value) => String(value || '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
const unhash = (name) => name.replace(/(?:_{1,2}|-)[A-Za-z0-9]{5,8}$/, '');

/** End index of the opening tag that starts at `start` (honours quotes and JSX braces). */
function openTagEnd(source, start) {
  let depth = 0; let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (ch === quote && source[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || (ch === '`' && depth > 0)) { quote = ch; continue; }
    if (ch === '{') depth += 1; else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth <= 0) return i + 1;
  }
  return -1;
}

/** Content of the element that opens at tagStart: up to its matching closing tag (same-name nesting is counted). */
function elementContent(source, tagStart, tagEnd, tagName) {
  if (tagEnd < 2 || source[tagEnd - 2] === '/') return '';
  const re = new RegExp(`<(/?)${tagName.replace(/\./g, '\\.')}(?=[\\s>/])`, 'g');
  re.lastIndex = tagEnd;
  let depth = 1;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return source.slice(tagEnd, m.index);
  }
  return source.slice(tagEnd, tagEnd + 4000);
}

const CLASS_ATTR = /(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/g;

/** JSX/HTML elements whose class literal matches the rendered classes. */
function locateMarkup(files, element, hints = {}) {
  const rendered = new Set(splitClasses(element.cls));
  if (!rendered.size) return [];
  const found = [];
  for (const file of files.filter((f) => textFile(f) && isMarkup(f))) {
    const source = file.content;
    CLASS_ATTR.lastIndex = 0;
    for (let m = CLASS_ATTR.exec(source); m; m = CLASS_ATTR.exec(source)) {
      const literal = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
      const tokens = splitClasses(literal);
      if (!tokens.length) continue;
      const exact = tokens.length === rendered.size && tokens.every((t) => rendered.has(t));
      const subset = tokens.length >= 2 && tokens.every((t) => rendered.has(t)) && tokens.length >= rendered.size * 0.6;
      if (!exact && !subset) continue;
      const valueStart = m.index + m[0].indexOf(literal, m[0].search(/["'`]/));
      const tagStart = source.lastIndexOf('<', m.index);
      const tagName = (source.slice(tagStart).match(/^<([A-Za-z][\w.]*)/) || [])[1];
      if (!tagName) continue;
      if (/^[a-z]/.test(tagName) && element.tag && tagName.toLowerCase() !== element.tag) continue;
      const tagEnd = openTagEnd(source, tagStart);
      const after = elementContent(source, tagStart, tagEnd, tagName);
      const textHit = (hints.texts || []).some((t) => t && after.includes(t.slice(0, 20)));
      found.push({ kind: 'markup', file: file.path, tagStart, tagEnd, tagName, literal, literalStart: valueStart, literalEnd: valueStart + literal.length, exact, textHit, selfClosing: tagEnd > 1 && source[tagEnd - 2] === '/' });
    }
  }
  const hit = found.filter((f) => f.textHit);
  const pool = (hit.length ? hit : found).sort((a, b) => Number(b.exact) - Number(a.exact));
  return pool.map((f, i) => ({ ...f, ambiguous: pool.length > 1 && !(hit.length === 1) && i === 0 && pool.filter((p) => p.exact === f.exact).length > 1 }));
}

// ---- CSS -----------------------------------------------------------------------------------------------------------
/** Minimal CSS scanner: rules (optionally inside one @media) with declarations and their source offsets. */
function parseCss(source) {
  const rules = [];
  const text = source;
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      while (i < to && /\s/.test(text[i])) i += 1;
      if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? to : end + 2; continue; }
      const open = text.indexOf('{', i);
      if (open < 0 || open >= to) break;
      let depth = 1; let j = open + 1;
      while (j < to && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
      const head = text.slice(i, open).trim();
      if (/^@media/i.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/i, ''));
      else if (!head.startsWith('@')) {
        const declarations = [];
        const body = text.slice(open + 1, j - 1);
        const re = /([a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*(?:;|$)/g;
        for (let d = re.exec(body); d; d = re.exec(body)) {
          const valueStart = open + 1 + d.index + d[0].indexOf(d[2], d[1].length);
          declarations.push({ prop: d[1].toLowerCase(), value: d[2], start: valueStart, end: valueStart + d[2].length });
        }
        rules.push({ selector: head, media, declarations, order: rules.length });
      }
      i = j;
    }
  };
  walk(0, text.length, null);
  return rules;
}

function mediaMatches(query, width) {
  if (!query) return true;
  const conds = [...String(query).matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/gi)];
  if (!conds.length) return false;
  return conds.every(([, kind, value, unit]) => { const n = Number(value) * (unit && unit !== 'px' ? 16 : 1); return kind.toLowerCase() === 'min' ? width >= n : width <= n; });
}

/** Stylesheet rules that style the element (class, id or plain tag selector), applicable at the viewport width. */
function locateCss(files, element, { viewportWidth = 1440 } = {}) {
  const classes = splitClasses(element.cls).flatMap((c) => [c, unhash(c)]);
  const out = [];
  const sheets = files.filter((f) => textFile(f) && (isCss(f) || /\.html?$/i.test(f.path || '')));
  for (const file of sheets) {
    const source = isCss(file) ? file.content : [...file.content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    if (!isCss(file) && !source.trim()) continue;
    for (const rule of parseCss(source)) {
      if (!mediaMatches(rule.media, viewportWidth)) continue;
      for (const part of rule.selector.split(',').map((s) => s.trim())) {
        const last = part.split(/\s+|>|\+|~/).filter(Boolean).pop() || '';
        if (/:(?:hover|focus|active|before|after|nth|first|last|not)/.test(last) && !/^[^:]+$/.test(last)) continue;
        const byClass = classes.some((c) => new RegExp(`\\.${c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`).test(last));
        const byId = element.domId && last === `#${element.domId}`;
        const byTag = last === element.tag;
        if (byClass || byId || byTag) { out.push({ kind: 'css', file: file.path, inline: !isCss(file), rule, specificity: byId ? 3 : byClass ? 2 : 1, selector: part }); break; }
      }
    }
  }
  return out.sort((a, b) => a.specificity - b.specificity);
}

/** Everything known about where an element's layout comes from. */
function resolveSource(files, element, hints = {}) {
  const markup = locateMarkup(files, element, hints);
  const css = locateCss(files, element, hints);
  const usedBy = new Set(markup.map((m) => m.file));
  return { markup, css, files: [...new Set([...markup.map((m) => m.file), ...css.map((c) => c.file)])], shared: css.some((c) => c.specificity === 1) || usedBy.size > 1 };
}

/** { start, end } of the element that opens at tagStart, including its closing tag (a self-closing tag ends at tagEnd). */
function elementSpan(source, tagStart, tagEnd, tagName) {
  if (tagEnd < 2 || source[tagEnd - 2] === '/') return { start: tagStart, end: tagEnd, selfClosing: true };
  const re = new RegExp(`<(/?)${tagName.replace(/\./g, '\\.')}(?=[\\s>/])`, 'g');
  re.lastIndex = tagEnd;
  let depth = 1;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { const close = source.indexOf('>', m.index); return { start: tagStart, end: close < 0 ? -1 : close + 1, selfClosing: false }; }
  }
  return { start: tagStart, end: -1, selfClosing: false };
}

module.exports = { elementSpan, resolveSource, locateMarkup, locateCss, parseCss, mediaMatches, splitClasses, openTagEnd, textFile };
