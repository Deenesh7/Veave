// Scripts that run INSIDE the preview frames. They are written as real functions (so they are checked and formatted like the rest of
// the code) and sent to the frame as text with toString(); they must not use anything from outside their own body.

/** In the website preview: a pen button at the top right of the section under the pointer. Clicking it sends that section to the studio. */
export function penScript() {
  var btn = document.createElement('button');
  btn.id = 'studio-pen';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Edit this section');
  btn.title = 'Edit this section';
  btn.style.cssText = 'position:fixed;z-index:2147483000;display:none;width:36px;height:36px;border-radius:999px;border:2px solid #fff;background:#5E7B5F;color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);align-items:center;justify-content:center;padding:0;margin:0';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  document.body.appendChild(btn);
  var cur = null;
  var enabled = true;
  function sectionOf(node) { return node && node.closest ? node.closest('section') : null; }
  function place() {
    if (!enabled || !cur) { btn.style.display = 'none'; return; }
    var r = cur.getBoundingClientRect();
    if (r.bottom < 48 || r.top > window.innerHeight - 48) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    btn.style.top = Math.max(r.top, 0) + 10 + 'px';
    btn.style.left = Math.max(Math.min(r.right, window.innerWidth) - 48, 8) + 'px';
  }
  document.addEventListener('mouseover', function (e) {
    if (e.target === btn || btn.contains(e.target)) return;
    var next = sectionOf(e.target);
    if (next !== cur) { cur = next; place(); }
  }, true);
  document.documentElement.addEventListener('mouseleave', function () { cur = null; place(); });
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (!cur) return;
    var heading = cur.querySelector('h1,h2,h3,h4');
    var name = norm(cur.getAttribute('aria-label') || (heading && heading.textContent) || cur.id);
    var clone = cur.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('script,[data-studio-pen]'), function (n) { n.remove(); });
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'))).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^data-studio-/.test(a.name)) n.removeAttribute(a.name); });
    });
    var head = Array.prototype.map.call(document.querySelectorAll('style,link[rel="stylesheet"]'), function (n) { return n.outerHTML; }).join('');
    var all = document.querySelectorAll('section');
    window.parent.postMessage({
      type: 'studio-section-edit', name: name.slice(0, 120), domId: cur.id || '', index: Array.prototype.indexOf.call(all, cur),
      html: clone.outerHTML, head: head, htmlClass: document.documentElement.className, bodyClass: document.body.className
    }, '*');
  });
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'studio-section-pen') { enabled = !!d.enabled; place(); }
  });
}

/** Inside the popup that shows ONE section: every piece of text can be typed over. Reports what changed to the studio. */
export function sectionEditScript() {
  var root = document.getElementById('studio-edit-root');
  var items = [];
  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function textNodes(el) { var out = []; for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 && norm(c.nodeValue)) out.push(c); } return out; }
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a,button,form,[role="tab"]');
    if (link) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  var skip = /^(SCRIPT|STYLE|SVG|PATH|INPUT|TEXTAREA|SELECT|OPTION|IMG|NOSCRIPT)$/i;
  var all = root.querySelectorAll('*');
  for (var i = 0; i < all.length; i += 1) {
    var el = all[i];
    if (skip.test(el.tagName) || (el.closest && el.closest('svg'))) continue;
    var nodes = textNodes(el);
    if (nodes.length !== 1 || norm(nodes[0].nodeValue).length < 2) continue;
    var target = el;
    if (el.children.length) {
      // A heading with a coloured span in it: the heading's own words get their own editable piece.
      target = document.createElement('span');
      target.textContent = nodes[0].nodeValue;
      el.replaceChild(target, nodes[0]);
    }
    target.setAttribute('data-studio-edit', String(items.length));
    target.setAttribute('contenteditable', 'true');
    target.setAttribute('spellcheck', 'true');
    items.push({ el: target, old: norm(nodes[0].nodeValue) });
  }
  function report() {
    var edits = [];
    items.forEach(function (item) { var now = norm(item.el.textContent); if (now !== item.old) edits.push({ old: item.old, next: now }); });
    window.parent.postMessage({ type: 'sec-edit-change', edits: edits }, '*');
  }
  function height() { window.parent.postMessage({ type: 'sec-edit-height', height: Math.ceil(root.getBoundingClientRect().height) }, '*'); }
  root.addEventListener('input', report);
  root.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
  window.addEventListener('load', function () { height(); setTimeout(height, 600); });
  window.addEventListener('resize', height);
  window.parent.postMessage({ type: 'sec-edit-ready', count: items.length }, '*');
  height();
}
