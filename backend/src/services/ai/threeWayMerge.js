'use strict';

/**
 * Line-based 3-way merge for text files that several parallel clone stages edit (App.jsx, shared CSS, ...).
 * Returns the merged text, or null when both sides changed the same lines differently.
 */

function lcsHunks(base, side) {
  const n = base.length;
  const m = side.length;
  if (n * m > 4_000_000) return [{ start: 0, end: n, lines: side }]; // too large to diff precisely: treat as one replacement
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = base[i] === side[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  let current = null;
  const flush = () => { if (current) { hunks.push(current); current = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) { flush(); i += 1; j += 1; continue; }
    if (!current) current = { start: i, end: i, lines: [] };
    if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) { current.lines.push(side[j]); j += 1; }
    else { i += 1; current.end = i; }
  }
  flush();
  return hunks;
}

function mergeText(baseText, oursText, theirsText) {
  if (oursText === theirsText) return oursText;
  if (oursText === baseText) return theirsText;
  if (theirsText === baseText) return oursText;
  const base = baseText.split('\n');
  const a = lcsHunks(base, oursText.split('\n'));
  const b = lcsHunks(base, theirsText.split('\n'));
  const all = [...a.map((h) => ({ ...h, side: 'a' })), ...b.map((h) => ({ ...h, side: 'b' }))]
    .sort((x, y) => x.start - y.start || x.end - y.end || (x.side < y.side ? -1 : 1));
  const out = [];
  let cursor = 0;
  for (let k = 0; k < all.length; k += 1) {
    const h = all[k];
    const next = all[k + 1];
    if (next && next.side !== h.side) {
      const bothInsert = h.start === h.end && next.start === next.end && h.start === next.start;
      const overlap = next.start < h.end || (next.start === h.end && (h.end > h.start || next.end > next.start) && next.start === h.start);
      if (bothInsert) { // same anchor, pure insertions: keep both
        out.push(...base.slice(cursor, h.start), ...h.lines, ...next.lines);
        cursor = h.start;
        k += 1;
        continue;
      }
      if (overlap) {
        if (h.start === next.start && h.end === next.end && h.lines.join('\n') === next.lines.join('\n')) { // identical change
          out.push(...base.slice(cursor, h.start), ...h.lines);
          cursor = h.end;
          k += 1;
          continue;
        }
        return null;
      }
    }
    if (h.start < cursor) return null;
    out.push(...base.slice(cursor, h.start), ...h.lines);
    cursor = h.end;
  }
  out.push(...base.slice(cursor));
  return out.join('\n');
}

module.exports = { mergeText };
