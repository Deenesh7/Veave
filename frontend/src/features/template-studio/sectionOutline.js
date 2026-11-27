// What the section shows, as plain lines (headings, texts, buttons, pictures, form fields), with the owner's typed changes applied.
// It goes to the AI with the instruction, so the AI starts from exactly what the owner is looking at.
export function sectionOutline(html, edits, limit = 1800) {
  let doc;
  try { doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html'); } catch { return ''; }
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const typed = new Map(edits.map((item) => [item.old, item.next]));
  const kind = (tag) => (/^h[1-6]$/.test(tag) ? 'Heading' : tag === 'button' || tag === 'a' ? 'Button or link' : tag === 'li' ? 'List item' : tag === 'label' ? 'Label' : 'Text');
  const lines = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll('#r *')) {
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|svg|path|noscript|option)$/.test(tag)) continue;
    if (tag === 'img') { const alt = norm(el.getAttribute('alt')); if (alt) lines.push(`- Picture: ${alt.slice(0, 90)}`); continue; }
    if (tag === 'input' || tag === 'textarea') { const hint = norm(el.getAttribute('placeholder') || el.getAttribute('aria-label')); if (hint) lines.push(`- Input field: ${hint.slice(0, 80)}`); continue; }
    if (tag === 'select') { lines.push(`- Dropdown: ${[...el.querySelectorAll('option')].map((option) => norm(option.textContent)).filter(Boolean).slice(0, 6).join(' / ').slice(0, 120)}`); continue; }
    let own = '';
    for (const node of el.childNodes) if (node.nodeType === 3) own += node.nodeValue;
    own = norm(own);
    if (own.length < 2) continue;
    const text = typed.get(own) ?? own;
    if (!text) continue; // deleted by the owner
    const key = `${tag}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = el.getAttribute('role') === 'tab' ? ' [tab]' : tag === 'button' && (el.getAttribute('type') || '').toLowerCase() === 'submit' ? ' [submit button]' : tag === 'button' ? ' [button]' : '';
    lines.push(`- ${kind(tag)}: "${text.slice(0, 220)}"${role}${typed.has(own) ? ' (typed by the owner)' : ''}`);
  }
  let out = '';
  for (const line of lines) { if (out.length + line.length + 1 > limit) { out += '\n- …'; break; } out += `${out ? '\n' : ''}${line}`; }
  return out;
}
