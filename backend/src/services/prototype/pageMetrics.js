'use strict';

/**
 * In-browser measurement of one rendered page at its current viewport.
 *
 * This single function is run (through page.evaluate) on the REFERENCE site and on the GENERATED project, so both are
 * measured by exactly the same code and can be compared. It must stay self-contained: Playwright serializes it, so it
 * may not use anything from this module's scope.
 */
function collectPageMetrics(options) {
  const opts = options || {};
  const maxAssets = opts.maxAssets || 300;
  const win = window;
  const doc = document;
  const body = doc.body;
  const scrollY0 = win.scrollY || 0;

  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const s = win.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const hex = (rgb) => {
    const m = String(rgb || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    if (m[3] !== undefined && Number(m[3]) === 0) return null;
    return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
  };
  const bump = (map, key, by) => { if (key !== null && key !== undefined && key !== '') map.set(key, (map.get(key) || 0) + (by || 1)); };
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => ({ value: e[0], count: e[1] }));
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const rectDoc = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY0), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== body && parts.length < 7) {
      let part = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift(`${part}#${node.id}`); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const absUrl = (value) => { try { return new URL(value, doc.baseURI).href; } catch (e) { return null; } };
  const bgImageUrl = (value) => { const m = String(value || '').match(/url\((['"]?)(.*?)\1\)/); return m ? absUrl(m[2]) : null; };

  // ---- typography: the most common computed style per text role
  const roles = {
    h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', p: 'p', a: 'main a, article a, section a', button: 'button, [role="button"], a[class*="btn"], a[class*="button"]',
    nav: 'nav a, header a', li: 'li', small: 'small, figcaption, label, .caption, [class*="caption"]', footer: 'footer a, footer p'
  };
  const typography = {};
  Object.keys(roles).forEach((role) => {
    const tally = new Map();
    const samples = new Map();
    [...doc.querySelectorAll(roles[role])].filter(visible).slice(0, 220).forEach((el) => {
      const s = win.getComputedStyle(el);
      if (!(el.textContent || '').trim()) return;
      const t = {
        fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontSize: s.fontSize, lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing, color: hex(s.color), textTransform: s.textTransform, textAlign: s.textAlign
      };
      const key = JSON.stringify(t);
      bump(tally, key);
      if (!samples.has(key)) samples.set(key, t);
    });
    const best = top(tally, 1)[0];
    if (best) typography[role] = { ...samples.get(best.value), count: best.count };
  });

  // ---- headings
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4')].filter(visible).slice(0, 80).map((el) => {
    const s = win.getComputedStyle(el);
    return { level: Number(el.tagName[1]), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140), fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily, color: hex(s.color), y: rectDoc(el).y };
  });

  // ---- colours, shadows, radii, borders, gradients, spacing
  const bgTally = new Map(); const fgTally = new Map(); const borderTally = new Map(); const shadowTally = new Map(); const radiusTally = new Map();
  const gradientTally = new Map(); const gapTally = new Map(); const padYTally = new Map(); const padXTally = new Map(); const gridTally = new Map(); const widthTally = new Map();
  const all = [...body.querySelectorAll('*')].slice(0, 2500);
  all.forEach((el) => {
    if (!visible(el)) return;
    const s = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.max(1, Math.round((r.width * r.height) / 1000));
    bump(bgTally, hex(s.backgroundColor), area);
    if ((el.textContent || '').trim() && el.children.length === 0) bump(fgTally, hex(s.color));
    if (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none') bump(borderTally, `${s.borderTopWidth} ${s.borderTopStyle} ${hex(s.borderTopColor)}`);
    if (s.boxShadow && s.boxShadow !== 'none') bump(shadowTally, s.boxShadow.slice(0, 120));
    if (s.borderRadius && s.borderRadius !== '0px') bump(radiusTally, s.borderRadius);
    if (s.backgroundImage && s.backgroundImage.indexOf('gradient') !== -1) bump(gradientTally, s.backgroundImage.slice(0, 200));
    if ((s.display === 'flex' || s.display === 'grid') && s.gap && s.gap !== 'normal') bump(gapTally, s.rowGap === s.columnGap ? s.rowGap : `${s.rowGap} ${s.columnGap}`);
    if (s.display === 'grid' && s.gridTemplateColumns !== 'none') bump(gridTally, s.gridTemplateColumns.split(' ').length);
    if (el.tagName === 'SECTION' || el.tagName === 'HEADER' || el.tagName === 'FOOTER') {
      if (s.paddingTop !== '0px') bump(padYTally, s.paddingTop);
      if (s.paddingBottom !== '0px') bump(padYTally, s.paddingBottom);
      if (s.paddingLeft !== '0px') bump(padXTally, s.paddingLeft);
    }
    if (s.maxWidth && s.maxWidth !== 'none' && s.marginLeft === s.marginRight && r.width > 300) bump(widthTally, s.maxWidth);
  });
  const bodyStyle = win.getComputedStyle(body);
  const htmlBg = hex(win.getComputedStyle(doc.documentElement).backgroundColor);
  const pageBackground = hex(bodyStyle.backgroundColor) || htmlBg || '#ffffff';

  // ---- buttons
  // A button is a <button>, a role=button, or a link that looks like one (filled background, padding), whatever its class is called.
  const isButtonLike = (b) => {
    if (!visible(b)) return false;
    const st = win.getComputedStyle(b);
    const fill = hex(st.backgroundColor);
    if (!fill || fill === pageBackground) return false;
    if (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button' || /btn|button/i.test(typeof b.className === 'string' ? b.className : '')) return true;
    return b.tagName === 'A' && px(st.paddingTop) >= 6 && px(st.paddingLeft) >= 12 && (b.textContent || '').trim().length < 40;
  };
  const btnEl = [...doc.querySelectorAll('button, a, [role="button"]')].find(isButtonLike);
  const buttons = btnEl ? (() => { const s = win.getComputedStyle(btnEl); return { background: hex(s.backgroundColor), color: hex(s.color), radius: s.borderRadius, padding: `${s.paddingTop} ${s.paddingRight}`, fontSize: s.fontSize, fontWeight: s.fontWeight, border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + hex(s.borderTopColor) }; })() : null;
  const linkEl = [...doc.querySelectorAll('a')].find((a) => visible(a) && hex(win.getComputedStyle(a).color) && hex(win.getComputedStyle(a).color) !== hex(bodyStyle.color));
  const cardEl = [...doc.querySelectorAll('[class*="card"], article, li')].find((c) => visible(c) && hex(win.getComputedStyle(c).backgroundColor) && hex(win.getComputedStyle(c).backgroundColor) !== pageBackground);
  const cards = cardEl ? (() => { const s = win.getComputedStyle(cardEl); return { background: hex(s.backgroundColor), border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + hex(s.borderTopColor), radius: s.borderRadius, shadow: s.boxShadow !== 'none' ? s.boxShadow.slice(0, 120) : null, padding: s.paddingTop }; })() : null;

  // ---- layout containers: the typical content width
  const mainEl = doc.querySelector('main') || body;
  const widths = [];
  [...mainEl.querySelectorAll('section, header, footer, main > div, [class*="container"]')].filter(visible).slice(0, 80).forEach((el) => {
    [...el.children].filter(visible).forEach((child) => { const r = child.getBoundingClientRect(); if (r.width > 280 && r.width < win.innerWidth - 8) widths.push(Math.round(r.width)); });
  });
  const widthMode = (() => { const t = new Map(); widths.forEach((w) => bump(t, Math.round(w / 8) * 8)); const b = top(t, 1)[0]; return b ? b.value : null; })();

  // ---- sections (top-level page blocks)
  const rootsRaw = [...(doc.querySelector('main') ? doc.querySelector('main').children : body.children)];
  const headerEl = doc.querySelector('header, [role="banner"]');
  const footerEl = doc.querySelector('footer, [role="contentinfo"]');
  const blocks = [];
  if (headerEl && visible(headerEl)) blocks.push(headerEl);
  const expand = (el) => (el.children.length === 1 && el.firstElementChild.children.length > 1 && el.firstElementChild.tagName !== 'UL' ? expand(el.firstElementChild) : el);
  rootsRaw.filter((el) => visible(el) && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) && el !== headerEl && el !== footerEl).forEach((raw) => {
    const el = expand(raw);
    // a wrapper that only contains several real sections: use its children
    // Only full-width blocks count as separate sections; cards sitting side by side in a grid stay one section.
    const inner = [...el.children].filter((c) => visible(c) && (c.tagName === 'SECTION' || c.tagName === 'ARTICLE' || c.getBoundingClientRect().height > 120) && c.getBoundingClientRect().width >= win.innerWidth * 0.85);
    const repeated = inner.length >= 3 && new Set(inner.map((c) => c.tagName + '|' + c.className)).size === 1; // a list of cards, not sections
    const landmarks = inner.length > 0 && inner.every((c) => /^(SECTION|ASIDE|NAV|HEADER|FOOTER)$/.test(c.tagName) || c.tagName === 'DIV');
    if (el.tagName === 'DIV' && inner.length >= 2 && inner.length === [...el.children].filter(visible).length && landmarks && !repeated && inner.every((c) => c.getBoundingClientRect().height > 80)) inner.forEach((c) => blocks.push(c)); else blocks.push(el);
  });
  if (footerEl && visible(footerEl) && blocks.indexOf(footerEl) === -1) blocks.push(footerEl);
  const sections = blocks.slice(0, 40).map((el, index) => {
    const s = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const h = el.querySelector('h1,h2,h3');
    const imgs = [...el.querySelectorAll('img, picture, video, svg')].filter(visible).length;
    const buttonsN = [...el.querySelectorAll('button, a, [role="button"]')].filter(isButtonLike).length;
    let itemsN = [...el.querySelectorAll(':scope > div > div, :scope > ul > li, :scope li, :scope article')].filter(visible).length;
    // a grid/flex row whose direct children are the cards (no wrapper div in between)
    const holders = [el].concat([...el.children].filter((c) => c.tagName === 'DIV' || c.tagName === 'UL'));
    holders.forEach((holder) => { const hs = win.getComputedStyle(holder); if (hs.display === 'grid' || hs.display === 'flex') { const kids = [...holder.children].filter(visible).length; if (kids >= 3 && kids > itemsN) itemsN = kids; } });
    const tag = el.tagName.toLowerCase();
    const kind = el === headerEl || tag === 'header' || tag === 'nav' ? 'header' : el === footerEl || tag === 'footer' ? 'footer'
      : (el.querySelector('h1') ? 'hero' : (imgs > 3 ? 'gallery' : (itemsN > 2 ? 'cards' : (/<form/i.test(el.innerHTML.slice(0, 4000)) || el.querySelector('form') ? 'form' : 'content'))));
    const gridHolder = [el].concat([...el.children]).find((n) => { const ns = win.getComputedStyle(n); return ns.display === 'grid' && ns.gridTemplateColumns !== 'none'; });
    const columns = gridHolder ? win.getComputedStyle(gridHolder).gridTemplateColumns.split(' ').length : (s.display === 'flex' && s.flexDirection.indexOf('row') === 0 ? 'flex-row' : 'block');
    return {
      index, tag, kind, selector: cssPath(el),
      heading: h ? (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      headingLevel: h ? Number(h.tagName[1]) : 0,
      headingFontSize: h ? win.getComputedStyle(h).fontSize : null,
      textLength: (el.innerText || '').trim().length, words: ((el.innerText || '').trim().match(/\S+/g) || []).length,
      images: imgs, buttons: buttonsN, items: Math.min(itemsN, 40), columns,
      background: hex(s.backgroundColor) || (s.backgroundImage && s.backgroundImage !== 'none' ? 'image/gradient' : 'transparent'),
      paddingY: `${s.paddingTop} / ${s.paddingBottom}`, align: s.textAlign,
      rect: rectDoc(el), fullBleed: r.width >= win.innerWidth - 20
    };
  });

  // ---- navigation (including links inside menus that are closed)
  const nav = [];
  const seenNav = new Set();
  const collectNav = (rootSel, group) => {
    [...doc.querySelectorAll(rootSel)].forEach((root) => {
      [...root.querySelectorAll('a[href]')].slice(0, 120).forEach((a) => {
        const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
        const href = absUrl(a.getAttribute('href'));
        if (!label || label.length > 60 || !href) return;
        const key = group + '|' + href + '|' + label;
        if (seenNav.has(key)) return;
        seenNav.add(key);
        let level = 0; let parentLabel = '';
        for (let n = a.parentElement; n && n !== root; n = n.parentElement) {
          if (n.tagName === 'UL' || n.tagName === 'OL') { level += 1; const owner = n.parentElement && n.parentElement.closest('li'); const lead = owner && owner.querySelector(':scope > a, :scope > button'); if (lead && lead !== a && !parentLabel) parentLabel = (lead.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
        }
        nav.push({ label, href, group, level: Math.max(0, level - 1), parentLabel, hidden: !visible(a) });
      });
    });
  };
  collectNav('header, nav, [role="navigation"]', 'header');
  collectNav('footer', 'footer');
  const links = [...new Set([...doc.querySelectorAll('a[href]')].map((a) => absUrl(a.getAttribute('href'))).filter(Boolean))].slice(0, 400);

  // ---- assets, each tied to the element it appears in
  const assets = [];
  const sectionIndexOf = (el) => { for (let i = 0; i < blocks.length; i += 1) if (blocks[i].contains(el)) return i; return -1; };
  const zone = (el) => (headerEl && headerEl.contains(el) ? 'header' : footerEl && footerEl.contains(el) ? 'footer' : (el.closest('nav') ? 'nav' : 'body'));
  const pushAsset = (el, kind, src, extra) => {
    if (!src || assets.length >= maxAssets || /^data:image\/gif;base64,R0lGODlhAQABA/i.test(src)) return;
    const r = el.getBoundingClientRect();
    assets.push(Object.assign({
      kind, src, tag: el.tagName.toLowerCase(), selector: cssPath(el), alt: (el.getAttribute && el.getAttribute('alt')) || '',
      title: (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '',
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      rect: rectDoc(el), visible: visible(el), zone: zone(el), sectionIndex: sectionIndexOf(el),
      inLink: Boolean(el.closest('a')), linkHref: el.closest('a') ? absUrl(el.closest('a').getAttribute('href')) : null,
      nearText: ((el.closest('figure, article, li, section, div') || el).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      objectFit: win.getComputedStyle(el).objectFit, borderRadius: win.getComputedStyle(el).borderRadius, order: assets.length
    }, extra || {}));
  };
  [...doc.querySelectorAll('img')].forEach((el) => {
    const src = el.currentSrc || el.src || absUrl(el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '');
    pushAsset(el, 'img', src, { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, loaded: el.complete && el.naturalWidth > 0, decorative: el.getAttribute('alt') === '' || el.getAttribute('role') === 'presentation' });
  });
  [...doc.querySelectorAll('video[poster]')].forEach((el) => pushAsset(el, 'video-poster', absUrl(el.getAttribute('poster')), { loaded: true }));
  [...doc.querySelectorAll('svg')].filter(visible).slice(0, 80).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width >= 24 || el.closest('a')) pushAsset(el, 'svg', 'inline-svg:' + cssPath(el), { loaded: true, inline: true });
  });
  all.forEach((el) => {
    if (assets.length >= maxAssets || !visible(el)) return;
    const u = bgImageUrl(win.getComputedStyle(el).backgroundImage);
    if (u) pushAsset(el, 'background', u, { loaded: true, backgroundSize: win.getComputedStyle(el).backgroundSize });
  });

  // ---- defects a person would see
  const horizontalOverflow = doc.documentElement.scrollWidth - win.innerWidth;
  const zeroImages = assets.filter((a) => a.kind === 'img' && a.visible && (a.rect.w < 2 || a.rect.h < 2)).map((a) => ({ src: a.src, selector: a.selector }));
  const brokenImages = assets.filter((a) => a.kind === 'img' && a.visible && a.loaded === false).map((a) => ({ src: a.src, selector: a.selector }));
  const clipped = [];
  all.forEach((el) => {
    if (clipped.length >= 12 || !visible(el)) return;
    const s = win.getComputedStyle(el);
    if (['hidden', 'clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 4 && (el.innerText || '').trim().length > 0 && el.children.length < 8) clipped.push({ selector: cssPath(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  });
  const overlaps = [];
  sections.forEach((a, i) => {
    const b = sections[i + 1];
    if (!b || overlaps.length >= 8) return;
    const overlap = (a.rect.y + a.rect.h) - b.rect.y;
    if (overlap > 24 && a.rect.h > 0 && b.rect.h > 0 && b.rect.y >= a.rect.y) overlaps.push({ a: a.selector, b: b.selector, by: Math.round(overlap) });
  });
  const emptySections = sections.filter((x) => x.kind !== 'header' && x.kind !== 'footer' && x.textLength < 3 && x.images === 0).map((x) => x.selector);

  // ---- breakpoints written in the CSS, loaded fonts, asset slots
  const breakpoints = new Set();
  [...doc.styleSheets].forEach((sheet) => {
    let rules; try { rules = [...sheet.cssRules]; } catch (e) { return; }
    const walk = (list) => list.forEach((rule) => { if (rule.type === 4) { const m = String(rule.conditionText || rule.media.mediaText).match(/(min|max)-width:\s*([\d.]+)px/g); if (m) m.forEach((x) => breakpoints.add(x.replace(/\s+/g, ''))); if (rule.cssRules) walk([...rule.cssRules]); } });
    walk(rules);
  });
  const fontsLoaded = []; try { doc.fonts.forEach((f) => { if (f.status === 'loaded') fontsLoaded.push(f.family.replace(/["']/g, '')); }); } catch (e) { /* no font API */ }
  const slots = [...doc.querySelectorAll('[data-asset-slot]')].map((el) => {
    const r = el.getBoundingClientRect();
    const isImg = el.tagName === 'IMG';
    return { slot: el.getAttribute('data-asset-slot'), tag: el.tagName.toLowerCase(), src: isImg ? (el.currentSrc || el.src) : (bgImageUrl(win.getComputedStyle(el).backgroundImage) || ''), width: Math.round(r.width), height: Math.round(r.height), naturalWidth: isImg ? el.naturalWidth : null, naturalHeight: isImg ? el.naturalHeight : null, loaded: isImg ? (el.complete && el.naturalWidth > 0) : true, visible: visible(el), sectionIndex: sectionIndexOf(el), selector: cssPath(el) };
  });

  const description = (doc.querySelector('meta[name="description"]') || {}).content || '';
  return {
    url: win.location.href, title: doc.title || '', description, lang: doc.documentElement.lang || '',
    viewport: { width: win.innerWidth, height: win.innerHeight },
    scrollHeight: doc.documentElement.scrollHeight, horizontalOverflow: Math.max(0, horizontalOverflow),
    textLength: (body.innerText || '').trim().length, wordCount: ((body.innerText || '').trim().match(/\S+/g) || []).length,
    pageBackground, bodyColor: hex(bodyStyle.color), linkColor: linkEl ? hex(win.getComputedStyle(linkEl).color) : null,
    typography, headings, sections, nav, links, assets, slots,
    colors: { background: top(bgTally, 10), text: top(fgTally, 10), borders: top(borderTally, 6) },
    gradients: top(gradientTally, 8), shadows: top(shadowTally, 6), radii: top(radiusTally, 8),
    spacing: { sectionPaddingY: top(padYTally, 6), sectionPaddingX: top(padXTally, 4), gaps: top(gapTally, 8) },
    grid: { columns: top(gridTally, 5), maxWidths: top(widthTally, 5), contentWidth: widthMode },
    buttons, cards, breakpoints: [...breakpoints].sort().slice(0, 24), fontsLoaded: [...new Set(fontsLoaded)].slice(0, 12),
    defects: { zeroImages, brokenImages, clipped, overlaps, emptySections, horizontalOverflow: Math.max(0, horizontalOverflow) }
  };
}

module.exports = { collectPageMetrics };
