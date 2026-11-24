// Scripts that run INSIDE the preview frames. They are written as real functions (so they are checked and formatted like the rest of
// the code) and sent to the frame as text with toString(); they must not use anything from outside their own body.

/**
 * Runs first in the preview and tells the other scripts what a "section" of the page is. Pages are not all built from <section> tags:
 * on one page the blocks are <section>s, on another they are a <header> and plain <div>s. So it is decided from the page's structure
 * and nothing else (no names, routes or class names): the blocks are the top-level pieces of the page's content area (the <main>, or the
 * app root without the site's own header, navigation and footer), looking inside a wrapper that holds only one block-sized child. A real
 * <section> inside that content is preferred, as before. Exposes window.__studioBlocks = { all(), of(node) }.
 */
export function blocksScript() {
  // Scripts and styles are not content, and a picture, video or frame is not a section (it holds no text to edit).
  var SKIP = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META|IMG|PICTURE|VIDEO|CANVAS|SVG|IFRAME)$/i;
  var CHROME = /^(HEADER|NAV|FOOTER)$/;
  function shown(el) {
    if (!el || el.nodeType !== 1 || SKIP.test(el.tagName)) return false;
    var r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 40) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'fixed';
  }
  function kids(el, withoutChrome) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) { if (shown(c) && !(withoutChrome && CHROME.test(c.tagName))) out.push(c); }
    return out;
  }
  // A block is something with a real size of its own: a section or an article, a heading band, or anything at least 120px tall.
  function blockSized(c) { return /^(SECTION|ARTICLE|HEADER)$/.test(c.tagName) || c.getBoundingClientRect().height >= 120; }
  function top() {
    var el = document.querySelector('main') || document.getElementById('root') || document.body;
    var withoutChrome = el.tagName !== 'MAIN';
    var list = kids(el, withoutChrome);
    for (var depth = 0; depth < 4 && list.length === 1; depth += 1) {
      var inner = kids(list[0], false);
      if (inner.filter(blockSized).length < 2) break;
      el = list[0];
      list = inner;
    }
    return list;
  }
  function all() {
    var list = top();
    return list.length ? list : Array.prototype.slice.call(document.querySelectorAll('section'));
  }
  function of(node) {
    var start = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!start) return null;
    var blocks = all();
    var inside = function (el) { return blocks.some(function (b) { return b === el || b.contains(el); }); };
    var section = start.closest ? start.closest('section') : null;
    if (section && inside(section)) return section;
    for (var n = start; n && n !== document.body; n = n.parentElement) { if (blocks.indexOf(n) >= 0) return n; }
    return null;
  }
  window.__studioBlocks = { all: all, of: of };
}

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
  // What a section is comes from the shared helper (a <section>, or the page's top-level block on pages that do not use <section>).
  function blocks() { return window.__studioBlocks || { all: function () { return document.querySelectorAll('section'); }, of: function (n) { return n && n.closest ? n.closest('section') : null; } }; }
  function sectionOf(node) { return blocks().of(node); }
  // How far down the page's own fixed or sticky navigation bar reaches from the top of the window (0 when there is none). A section that
  // is scrolled under it is only visible below it, so that is where the button belongs.
  function topInset() {
    var inset = 0;
    var stack = document.elementsFromPoint(Math.round(window.innerWidth / 2), 2);
    for (var i = 0; i < stack.length; i += 1) {
      var el = stack[i];
      if (el === btn || el === document.documentElement || el === document.body) continue;
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        var position = window.getComputedStyle(n).position;
        if (position === 'fixed' || position === 'sticky') {
          var box = n.getBoundingClientRect();
          if (box.width >= window.innerWidth * 0.5 && box.height < window.innerHeight * 0.5) inset = Math.max(inset, box.bottom);
          break;
        }
      }
    }
    return Math.max(0, Math.min(inset, 400));
  }
  function place() {
    if (!enabled || !cur) { btn.style.display = 'none'; return; }
    var r = cur.getBoundingClientRect();
    var visibleTop = Math.max(r.top, topInset());
    if (r.bottom - visibleTop < 48 || r.top > window.innerHeight - 48) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    btn.style.top = visibleTop + 10 + 'px';
    btn.style.left = Math.max(Math.min(r.right, window.innerWidth) - 48, 8) + 'px';
  }
  // The pointer often crosses the navigation bar (or a gap) on its way to the button: leaving the section only hides the button after a
  // short pause, and not at all while the pointer is on the button.
  var leaveTimer = null;
  document.addEventListener('mouseover', function (e) {
    if (e.target === btn || btn.contains(e.target)) { clearTimeout(leaveTimer); return; }
    var next = sectionOf(e.target);
    clearTimeout(leaveTimer);
    if (next) { if (next !== cur) { cur = next; place(); } return; }
    leaveTimer = setTimeout(function () { cur = null; place(); }, 700);
  }, true);
  document.documentElement.addEventListener('mouseleave', function () { clearTimeout(leaveTimer); leaveTimer = setTimeout(function () { cur = null; place(); }, 700); });
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
    var all = blocks().all();
    window.parent.postMessage({
      type: 'studio-section-edit', name: name.slice(0, 120), domId: cur.id || '', index: Array.prototype.indexOf.call(all, cur),
      html: clone.outerHTML, head: head, htmlClass: document.documentElement.className, bodyClass: document.body.className
    }, '*');
  });
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'studio-section-pen') { enabled = !!d.enabled; place(); }
    if (d && d.type === 'studio-section-get') {
      // The studio's page prompt asks for what one section shows right now, so the AI gets the same context as the section pop-up.
      var list = Array.prototype.slice.call(blocks().all()).concat(Array.prototype.slice.call(document.querySelectorAll('section')));
      var found = d.domId ? document.getElementById(d.domId) : null;
      if (!found || !blocks().of(found)) {
        found = null;
        var want = norm(d.name).toLowerCase();
        Array.prototype.forEach.call(list, function (sec) {
          var h = sec.querySelector('h1,h2,h3,h4');
          if (!found && want && ((h && norm(h.textContent).toLowerCase() === want) || norm(sec.getAttribute('aria-label')).toLowerCase() === want)) found = sec;
        });
      } else { found = blocks().of(found); }
      var out = '';
      if (found) {
        var clone = found.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('script,[data-studio-pen]'), function (n) { n.remove(); });
        [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'))).forEach(function (n) {
          Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^data-studio-/.test(a.name)) n.removeAttribute(a.name); });
        });
        out = clone.outerHTML;
      }
      // The styles travel with the markup: a change can add new classes, and the section pop-up must be drawn with the page's current CSS.
      var head = Array.prototype.map.call(document.querySelectorAll('style,link[rel="stylesheet"]'), function (n) { return n.outerHTML; }).join('');
      window.parent.postMessage({ type: 'studio-section-html', key: d.key, html: out, head: head, htmlClass: document.documentElement.className, bodyClass: document.body.className }, '*');
    }
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
