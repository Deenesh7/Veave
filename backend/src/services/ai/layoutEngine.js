const capturedHtmlView = require('../clone/capturedHtmlView');

/**
 * Arranges images that a captured page stacks (or lines up) in the wrong direction, without asking a model.
 *
 * A captured page keeps its markup as one string. The images the user means sit in blocks that are children of one container
 * that also holds the rest of the content, so restyling the container would move everything. This wraps ONLY the run of
 * sibling blocks that holds those images in a new element, and gives that element the requested arrangement. Everything else
 * stays byte for byte as it was.
 *
 * The caller measures the page (which blocks hold the images) and verifies the result by rendering it; this module only
 * edits text and refuses (returns null) whenever the markup does not allow an exact, unambiguous edit.
 */

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index just after the element that starts at `start` (balanced for the same tag name), or -1. */
function elementEnd(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let match = re.exec(html); match; match = re.exec(html)) {
    if (match[2] === '/') { if (depth === 0) return match.index + match[0].length; continue; }
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

/** Start index of the one element whose opening tag carries exactly this class attribute, or -1 (also -1 when it is not unique). */
function uniqueStart(html, tag, cls) {
  const re = new RegExp(`<${tag}\\b[^>]*\\bclass="${escapeRegExp(cls)}"[^>]*>`, 'g');
  const hits = [...html.matchAll(re)];
  return hits.length === 1 ? hits[0].index : -1;
}

/**
 * @param {Array}  files
 * @param {{children:Array<{tag:string,cls:string,holds:boolean}>}} measured  blocks of the common container, in order
 * @param {{orientation:'row'|'column'}} request
 * @returns {{files:Array, path:string, items:number, rows:number} | null}
 */
function arrangeCapturedBlocks(files, measured, request) {
  const children = Array.isArray(measured?.children) ? measured.children : [];
  const holders = children.map((child, index) => (child.holds ? index : -1)).filter((index) => index >= 0);
  if (holders.length < 2 || !request) return null;
  // Each image block together with the blocks that follow it up to the next image block (its caption) is one item.
  const gaps = holders.slice(1).map((index, i) => index - holders[i]).sort((x, y) => x - y);
  const typical = gaps[Math.floor(gaps.length / 2)];
  if (typical < 1 || typical > 4) return null;
  const groups = holders.map((start, i) => ({ start, end: i < holders.length - 1 ? holders[i + 1] - 1 : Math.min(children.length - 1, start + typical - 1) }));
  if (groups.some((group) => group.end - group.start + 1 > 5)) return null;
  const used = children.slice(groups[0].start, groups[groups.length - 1].end + 1);
  if (used.some((child) => !child.cls || !/^[a-z0-9]+$/i.test(child.tag))) return null;

  for (const file of files) {
    if (!file || typeof file.content !== 'string' || !/\.jsx?$/i.test(file.path)) continue;
    const parsed = capturedHtmlView.parse(file.content);
    if (!parsed) continue;
    const html = parsed.html;
    // Exact positions of every block of every group; any block that cannot be found exactly once rules this file out.
    const positions = [];
    let ok = true;
    for (const group of groups) {
      const first = children[group.start];
      const last = children[group.end];
      const from = uniqueStart(html, first.tag, first.cls);
      const lastStart = uniqueStart(html, last.tag, last.cls);
      const to = lastStart >= 0 ? elementEnd(html, lastStart, last.tag) : -1;
      if (from < 0 || lastStart < from || to < 0) { ok = false; break; }
      positions.push({ from, to });
    }
    if (!ok || positions.some((pos, i) => i > 0 && pos.from < positions[i - 1].to)) continue;

    const items = groups.length;
    const css = request.orientation === 'row'
      ? `.veave-arranged{display:grid;grid-template-columns:repeat(${items},minmax(0,1fr));column-gap:16px;align-items:start;width:100%}.veave-arranged-item{min-width:0}.veave-arranged-item>*{grid-area:auto!important;position:relative!important;width:auto!important;min-width:0!important;margin-left:0!important;margin-right:0!important}.veave-arranged img{position:static!important;width:100%!important;height:auto!important;max-width:100%!important;min-height:0!important}`
      : '.veave-arranged{display:flex;flex-direction:column;width:100%}.veave-arranged-item>*{grid-area:auto!important;position:relative!important;width:100%!important}';
    let out = '';
    let cursor = positions[0].from;
    out += `<style>${css}</style><div class="veave-arranged">`;
    positions.forEach((pos, i) => {
      out += `${i ? html.slice(cursor, pos.from) : ''}<div class="veave-arranged-item">${html.slice(pos.from, pos.to)}</div>`;
      cursor = pos.to;
    });
    out += '</div>';
    const next = `${html.slice(0, positions[0].from)}${out}${html.slice(cursor)}`;
    const content = `${file.content.slice(0, parsed.start)}${JSON.stringify(next)}${file.content.slice(parsed.end)}`;
    return { files: files.map((item) => (item === file ? { ...item, content } : item)), path: file.path, items, rows: 1 };
  }
  return null;
}

module.exports = { arrangeCapturedBlocks, elementEnd, uniqueStart };
