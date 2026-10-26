const { chromium } = require('playwright');
const { launchChromium } = require('../browser/launchChromium');
const { validatePublicUrl } = require('./websiteCaptureService');

// "Use this website as a prototype": a compact structural/visual brief of a public page. It deliberately carries the
// LAYOUT (sections, patterns, palette, type) and not the content, so the generated site is the user's own.

const KEYWORDS = /\b(prototype|template|reference|inspired?|inspiration|like|similar to|based on|model(?:led)? (?:on|after))\b/i;

function detectPrototypeUrl(payload = {}) {
  const explicit = payload?.prototype?.url;
  if (typeof explicit === 'string' && /^https?:\/\//i.test(explicit.trim())) return explicit.trim();
  const prompt = String(payload?.prompt || '');
  const match = prompt.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match && KEYWORDS.test(prompt) ? match[0].replace(/[.,;:!?]+$/, '') : null;
}

const googleFonts = require('./googleFonts');

// Sample strings whose rendered widths fingerprint a typeface (proportions, x-height, width of caps vs lowercase).
const SAMPLES = ['Hamburgefonstiv', 'The quick brown fox jumps over', 'MWiliMW', 'aeoceoaeo'];

// Runs inside the page: `samples` must be passed in (page functions cannot see Node variables).
const measureWidths = ({ stack, samples }) => {
  const canvas = document.createElement('canvas').getContext('2d');
  return samples.map((text) => { canvas.font = `400 100px ${stack}`; return canvas.measureText(text).width; });
};

/** Free font that renders closest to `target` (measured from the real site) among the most popular of its category. */
async function matchFontByMetrics(context, candidates, targetWidths) {
  if (!candidates.length || !targetWidths?.length) return candidates[0]?.family || null;
  const page = await context.newPage();
  try {
    const query = candidates.map((c) => `family=${encodeURIComponent(c.family).replace(/%20/g, '+')}`).join('&');
    await page.setContent(`<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=block"></head><body>x</body></html>`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    const scores = await page.evaluate(async ({ families, samples, target }) => {
      const ctx = document.createElement('canvas').getContext('2d');
      const out = [];
      for (const family of families) {
        await document.fonts.load(`400 100px "${family}"`, 'Hamburgefonstiv').catch(() => {});
        const widths = samples.map((text) => { ctx.font = `400 100px "${family}", monospace`; return ctx.measureText(text).width; });
        const loaded = document.fonts.check(`400 100px "${family}"`);
        const distance = widths.reduce((sum, w, i) => sum + ((w - target[i]) / target[i]) ** 2, 0);
        out.push({ family, distance, loaded });
      }
      return out;
    }, { families: candidates.map((c) => c.family), samples: SAMPLES, target: targetWidths });
    const best = scores.filter((entry) => entry.loaded).sort((a, b) => a.distance - b.distance)[0];
    return best?.family || candidates[0].family;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Resolve a CSS stack to a loadable Google Font: exact name if offered, otherwise the closest by measured metrics. */
async function resolveFontDynamic(stack, { catalogue, context, pageMeasure }) {
  const original = String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '') || 'system';
  const exact = googleFonts.findFamily(catalogue, stack);
  if (exact) return { original, google: exact.family, how: 'same family' };
  const candidates = googleFonts.topByCategory(catalogue, googleFonts.categoryOf(stack), 40);
  if (!candidates.length) return { original, google: null, how: 'none' };
  const target = pageMeasure ? await pageMeasure(stack).catch(() => null) : null;
  const google = await matchFontByMetrics(context, candidates, target).catch(() => candidates[0].family);
  return { original, google, how: target ? 'closest by measured metrics' : 'most popular in category' };
}

const toRgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const saturation = (hex) => { const rgb = toRgb(hex); if (!rgb) return 0; const [r, g, b] = rgb.map((v) => v / 255); const max = Math.max(r, g, b); const min = Math.min(r, g, b); return max === 0 ? 0 : (max - min) / max; };
const luminance = (hex) => { const rgb = toRgb(hex); return rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0.5; };

function deriveStyle(snapshot, fonts = {}) {
  const bg = snapshot.pageBackground || '#ffffff';
  const text = snapshot.bodyColor || '#111111';
  const chromatic = (snapshot.palette || []).filter((c) => saturation(c) > 0.35 && luminance(c) > 0.12 && luminance(c) < 0.9);
  const brand = snapshot.buttonColors?.bg && saturation(snapshot.buttonColors.bg) > 0.3 ? snapshot.buttonColors.bg : (chromatic[0] || snapshot.linkColor || snapshot.buttonColors?.bg || text);
  const neutral = (snapshot.palette || []).filter((c) => saturation(c) < 0.12 && c !== bg && c !== text);
  const pick = (resolved, stack) => resolved || { original: String(stack || '').split(',')[0].replace(/["']/g, '').trim() || 'system', google: null };
  const headingFont = pick(fonts.heading, snapshot.fontStacks?.h1 || snapshot.fontStacks?.h2 || snapshot.fontStacks?.body);
  const bodyFont = pick(fonts.body, snapshot.fontStacks?.body);
  const fontName = (f) => f.google || f.original;
  const bgLum = luminance(bg);
  const byCloseness = [...(snapshot.palette || [])].filter((c) => c !== bg && saturation(c) < 0.2 && Math.abs(luminance(c) - bgLum) > 0.01)
    .sort((a, b) => Math.abs(luminance(a) - bgLum) - Math.abs(luminance(b) - bgLum));
  const surface = byCloseness.find((c) => Math.abs(luminance(c) - bgLum) < 0.15) || bg;
  const border = byCloseness.find((c) => Math.abs(luminance(c) - bgLum) >= 0.03 && Math.abs(luminance(c) - bgLum) < 0.3) || (bgLum > 0.5 ? '#e5e7eb' : '#27272a');
  const readable = (c) => c && Math.abs(luminance(c) - bgLum) > 0.35;
  const linkCandidates = [snapshot.linkColor, ...chromatic].filter(readable);
  const tokens = {
    mood: 'Prototype look', primary: brand, secondary: linkCandidates[0] || text, bg, cardBg: surface, text,
    border, accent: chromatic.find((c) => c !== brand) || brand,
    radius: snapshot.buttonColors?.radius || '12px', font: `${fontName(bodyFont)}, sans-serif`, headingFont: `${fontName(headingFont)}, sans-serif`, prototypeControlled: true
  };
  const im = snapshot.imagery || {};
  const total = Math.max(im.total || 0, 1);
  const pct = (n) => Math.round(((n || 0) / total) * 100);
  const imagery = [
    `${im.total || 0} visible picture(s): ${pct(im.landscape)}% landscape, ${pct(im.portrait)}% portrait, ${pct(im.square)}% square`,
    im.fullBleed ? `${im.fullBleed} run edge to edge (full-bleed)` : 'none run edge to edge (they sit inside the content width)',
    im.backgroundImageSections ? `${im.backgroundImageSections} section(s) use a background image` : '',
    `object-fit: ${im.cover >= im.contain ? 'cover (cropped to fill)' : 'contain (whole subject shown on a clean background)'}`,
    im.rounded ? `rounded corners (${im.topRadius}) on ${pct(im.rounded)}% of pictures` : 'square corners, no rounding',
    im.shadows ? `drop shadows on ${pct(im.shadows)}% of pictures` : 'no shadows on pictures'
  ].filter(Boolean).join('; ');
  return { tokens, fonts: { heading: headingFont, body: bodyFont }, imagery };
}

function briefFromSnapshot(snapshot, url, style) {
  const lines = [];
  lines.push(`Source: ${new URL(url).hostname}`);
  if (snapshot.title) lines.push(`Page title style: "${snapshot.title.slice(0, 80)}"`);
  if (snapshot.nav?.length) lines.push(`Primary navigation (${snapshot.nav.length}): ${snapshot.nav.slice(0, 12).join(' | ')}`);
  lines.push(`Typography: headings ${snapshot.fonts.heading || 'default'}, body ${snapshot.fonts.body || 'default'}; h1 size ${snapshot.fonts.h1Size || 'n/a'}`);
  const fontLine = (role, f) => (f.google ? `${role} "${f.google}" (prototype uses ${f.original}; ${f.how || 'matched'})` : `${role} ${f.original}`);
  lines.push(`USE THESE FONTS (loaded from Google Fonts): ${fontLine('headings', style.fonts.heading)}, ${fontLine('body', style.fonts.body)}.`);
  lines.push(`USE THESE COLOURS EXACTLY (as Tailwind arbitrary values such as bg-[#f5f5f7]): page background ${style.tokens.bg}, text ${style.tokens.text}, brand/primary ${style.tokens.primary}, accent ${style.tokens.accent}, links ${style.tokens.secondary}, card surface ${style.tokens.cardBg}, borders ${style.tokens.border}, button radius ${style.tokens.radius}.`);
  lines.push(`IMAGE LOOK to reproduce: ${style.imagery}. Choose pictures with the same treatment and subject style and apply the same crop, corner radius, shadow and background behind them.`);
  lines.push(`Palette (most used): ${snapshot.palette.join(', ') || 'n/a'}`);
  lines.push(`Page background ${snapshot.pageBackground}; primary button ${snapshot.buttonStyle || 'n/a'}`);
  lines.push('Section order (top to bottom):');
  snapshot.sections.forEach((s, i) => lines.push(`  ${i + 1}. ${s.kind}${s.fullBleed ? ' (full-bleed)' : ''} ~${s.height}px tall | layout: ${s.layout} | heading: ${s.heading || '(none)'} | ${s.items} item(s), ${s.images} image(s), ${s.buttons} button(s) | bg ${s.background} | padding ${s.padding}`));
  const c = snapshot.code;
  if (c) {
    const parts = [];
    if (c.cssVars?.length) parts.push(`CSS variables: ${c.cssVars.slice(0, 24).join('; ')}`);
    if (c.gradients?.length) parts.push(`gradients: ${c.gradients.join(' | ')}`);
    if (c.shadows?.length) parts.push(`box-shadows: ${c.shadows.join(' | ')}`);
    if (c.transitions?.length) parts.push(`transition durations: ${c.transitions.join(', ')}`);
    if (c.keyframes?.length) parts.push(`animations: ${c.keyframes.join(', ')}`);
    if (c.fontFaces?.length) parts.push(`@font-face families: ${c.fontFaces.join(', ')}`);
    if (c.breakpoints?.length) parts.push(`breakpoints: ${c.breakpoints.join(', ')}`);
    if (c.framework) parts.push(`built with ${c.framework}`);
    if (parts.length) lines.push(`STYLESHEET SIGNALS (from the real CSS; recreate this styling with Tailwind/CSS, do not copy code verbatim): ${parts.join(' || ')}`);
    if (c.skeleton) lines.push(`MARKUP SKELETON (tag/class structure of the real HTML, text removed; use as a structural guide only): ${c.skeleton}`);
  }
  if (snapshot.footerColumns) lines.push(`Footer: ${snapshot.footerColumns} link column(s)`);
  return lines.join('\n');
}

async function captureInspiration(sourceUrl, { signal, timeoutMs = 45000, maxHeight = 5400 } = {}) {
  const url = await validatePublicUrl(sourceUrl);
  signal?.throwIfAborted();
  const browser = await launchChromium({ browserType: chromium });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
    });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const validated = new Set();
    await context.route('**/*', async (route) => {
      try {
        const parsed = new URL(route.request().url());
        if (!['data:', 'blob:', 'about:'].includes(parsed.protocol) && !validated.has(parsed.hostname)) { await validatePublicUrl(parsed.href); validated.add(parsed.hostname); }
        if (route.request().resourceType() === 'media') return route.abort();
        return route.continue();
      } catch { return route.abort('blockedbyclient'); }
    });
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const health = await page.evaluate(() => ({ title: document.title || '', text: (document.body?.innerText || '').slice(0, 600), nodes: document.querySelectorAll('body *').length })).catch(() => ({ title: '', text: '', nodes: 0 }));
    if (/just a moment|attention required|access denied|verify you are human|are you a robot|captcha|checking your browser/i.test(`${health.title} ${health.text}`) && health.nodes < 120) {
      throw new Error('The site blocked automated access (bot protection page), so its design could not be read.');
    }
    if (health.nodes < 8) throw new Error('The page rendered empty, so its design could not be read.');
    // Reveal lazy-loaded imagery and freeze animations so the screenshot shows the finished design.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}' }).catch(() => {});
    await page.evaluate(async () => {
      const step = Math.max(500, Math.floor(window.innerHeight * 0.7));
      for (let y = 0; y < document.documentElement.scrollHeight && y < 9000; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(1200);
    let image = null;
    try {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const shot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(height, maxHeight) } });
      const sharp = require('sharp');
      const resized = await sharp(shot).resize({ width: 1000 }).jpeg({ quality: 70 }).toBuffer();
      if (resized.length < 4.5 * 1024 * 1024) image = `data:image/jpeg;base64,${resized.toString('base64')}`;
    } catch { image = null; }
    const snapshot = await page.evaluate(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 40 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden'; };
      const color = (el, prop) => getComputedStyle(el)[prop];
      const hex = (rgb) => { const m = String(rgb).match(/\d+(\.\d+)?/g); if (!m || m.length < 3 || (m[3] !== undefined && Number(m[3]) === 0)) return null; return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join(''); };
      const tally = new Map();
      const bump = (c) => { if (c) tally.set(c, (tally.get(c) || 0) + 1); };
      document.querySelectorAll('body *').forEach((el, i) => { if (i > 1500 || !visible(el)) return; bump(hex(color(el, 'backgroundColor'))); bump(hex(color(el, 'color'))); });
      const palette = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
      const body = document.body;
      const h1 = document.querySelector('h1');
      const firstBtn = [...document.querySelectorAll('a,button')].find((b) => visible(b) && hex(color(b, 'backgroundColor')) && hex(color(b, 'backgroundColor')) !== hex(color(body, 'backgroundColor')));
      const roots = [...(document.querySelector('main')?.children || document.body.children)].filter((el) => visible(el) && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName));
      const sections = [];
      const expand = (el) => (el.children.length === 1 && el.firstElementChild.children.length > 1 ? expand(el.firstElementChild) : el);
      roots.forEach((raw) => {
        const el = expand(raw);
        if (!visible(el) || sections.length >= 20) return;
        const tag = el.tagName.toLowerCase();
        const imgs = el.querySelectorAll('img,svg,video').length;
        const buttons = el.querySelectorAll('button,a[class*=btn],a[class*=button]').length;
        const heading = el.querySelector('h1,h2,h3');
        const style = getComputedStyle(el);
        const cols = style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : (style.display === 'flex' ? 'flex-' + style.flexDirection : 'block');
        const cards = [...el.querySelectorAll(':scope > div > div, :scope > ul > li, :scope li')].filter(visible).length;
        let kind = ['header', 'nav'].includes(tag) ? 'header/navigation' : tag === 'footer' ? 'footer' : (el.querySelector('h1') ? 'hero' : (imgs > 3 ? 'gallery/cards' : (cards > 2 ? 'feature/card grid' : 'content')));
        const rect = el.getBoundingClientRect();
        const hs = heading ? getComputedStyle(heading) : null;
        sections.push({
          kind, layout: cols === 'block' ? 'stacked' : (typeof cols === 'number' ? cols + '-column grid' : cols),
          heading: heading ? `"${(heading.textContent || '').trim().slice(0, 60)}" ${hs.fontSize}/${hs.fontWeight}, ${hs.textAlign}, color ${hex(hs.color)}` : '',
          items: Math.min(cards, 24), images: Math.min(imgs, 24), buttons: Math.min(buttons, 8),
          background: hex(style.backgroundColor) || (style.backgroundImage && style.backgroundImage !== 'none' ? 'image/gradient' : 'transparent'),
          height: Math.round(rect.height), fullBleed: rect.width >= window.innerWidth - 20, padding: `${style.paddingTop} / ${style.paddingBottom}`
        });
      });
      // Imagery look: how pictures are cropped, rounded and placed.
      const media = [...document.querySelectorAll('img,video,picture')].filter(visible).slice(0, 120);
      const radii = new Map(); let landscape = 0; let portrait = 0; let square = 0; let shadows = 0; let bleed = 0; let cover = 0; let contain = 0; let rounded = 0;
      media.forEach((m) => {
        const r = m.getBoundingClientRect(); const cs = getComputedStyle(m);
        const ratio = r.width / Math.max(r.height, 1);
        if (ratio > 1.15) landscape += 1; else if (ratio < 0.87) portrait += 1; else square += 1;
        if (cs.boxShadow && cs.boxShadow !== 'none') shadows += 1;
        if (r.width >= window.innerWidth - 20) bleed += 1;
        if (cs.objectFit === 'cover') cover += 1; if (cs.objectFit === 'contain') contain += 1;
        const rad = cs.borderRadius || '0px'; if (rad !== '0px') { rounded += 1; radii.set(rad, (radii.get(rad) || 0) + 1); }
      });
      const bgImages = [...document.querySelectorAll('section,div,header')].filter((el) => visible(el) && getComputedStyle(el).backgroundImage.startsWith('url(')).length;
      const topRadius = [...radii.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '0px';
      const imagery = { total: media.length, landscape, portrait, square, shadows, fullBleed: bleed, cover, contain, rounded, topRadius, backgroundImageSections: Math.min(bgImages, 30) };
      const linkEl = [...document.querySelectorAll('a')].find((a) => visible(a) && hex(color(a, 'color')) && hex(color(a, 'color')) !== hex(color(body, 'color')));
      const cardEl = [...document.querySelectorAll('[class*=card],article,li')].find((c) => visible(c) && hex(color(c, 'backgroundColor')) && hex(color(c, 'backgroundColor')) !== hex(color(body, 'backgroundColor')));
      const fam = (el) => (el ? color(el, 'fontFamily') : '');
      const fontStacks = { h1: fam(h1), h2: fam(document.querySelector('h2')), body: fam(body), button: fam(firstBtn), nav: fam(document.querySelector('nav a')) };
      const footer = document.querySelector('footer');
      const nav = [...document.querySelectorAll('header a, nav a')].filter(visible).map((a) => (a.textContent || '').trim()).filter((t) => t && t.length < 28);
      // Real HTML/CSS signals: stylesheet design tokens, gradients, shadows, motion and a trimmed markup skeleton.
      const cssVars = new Map(); const keyframes = new Set(); const fontFaces = new Set(); const mediaQueries = new Set();
      for (const sheet of [...document.styleSheets]) {
        let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
        const walk = (list) => list.forEach((rule) => {
          if (rule.type === 1 && /^(:root|html|body|\.dark|\[data-theme)/.test(rule.selectorText || '')) {
            for (const prop of [...rule.style]) if (prop.startsWith('--') && cssVars.size < 40) cssVars.set(prop, rule.style.getPropertyValue(prop).trim().slice(0, 60));
          } else if (rule.type === 7) keyframes.add(rule.name);
          else if (rule.type === 5) fontFaces.add(rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim());
          else if (rule.type === 4) { if (mediaQueries.size < 8 && /width/.test(rule.conditionText)) mediaQueries.add(rule.conditionText.slice(0, 50)); walk([...rule.cssRules]); }
        });
        walk(rules);
      }
      const tallyOf = (prop, skip) => { const m = new Map(); document.querySelectorAll('body *').forEach((el, i) => { if (i > 1500) return; const v = getComputedStyle(el)[prop]; if (v && v !== skip) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v]) => v.slice(0, 140)); };
      const gradients = [...new Set([...document.querySelectorAll('body *')].slice(0, 1500).map((el) => getComputedStyle(el).backgroundImage).filter((v) => v.includes('gradient')).map((v) => v.slice(0, 140)))].slice(0, 3);
      const skeleton = (() => {
        const cut = (el, depth) => {
          if (depth > 4 || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME'].includes(el.tagName.toUpperCase())) return '';
          const tag = el.tagName.toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
          const kids = [...el.children].slice(0, 8).map((c) => cut(c, depth + 1)).filter(Boolean).join('');
          return `<${tag}${cls ? ` class="${cls}"` : ''}>${kids}</${tag}>`;
        };
        return cut(document.querySelector('main') || document.body, 0).slice(0, 2500);
      })();
      const htmlBg = hex(color(document.documentElement, 'backgroundColor'));
      const code = {
        cssVars: [...cssVars.entries()].map(([k, v]) => `${k}: ${v}`), keyframes: [...keyframes].slice(0, 10), fontFaces: [...fontFaces].slice(0, 8),
        breakpoints: [...mediaQueries], gradients, shadows: tallyOf('boxShadow', 'none'), transitions: tallyOf('transitionDuration', '0s'),
        framework: document.querySelector('[class*="tw-"],[class*="flex "],[class*=" px-"]') ? 'utility classes (Tailwind-like)' : (window.__NEXT_DATA__ ? 'Next.js' : ''),
        skeleton
      };
      return {
        code, title: document.title, nav: [...new Set(nav)].slice(0, 12),
        fonts: { heading: h1 ? color(h1, 'fontFamily').split(',')[0].replace(/["']/g, '') : '', body: color(body, 'fontFamily').split(',')[0].replace(/["']/g, ''), h1Size: h1 ? color(h1, 'fontSize') : '' },
        palette, pageBackground: hex(color(body, 'backgroundColor')) || htmlBg || '#ffffff',
        buttonStyle: firstBtn ? `bg ${hex(color(firstBtn, 'backgroundColor'))}, text ${hex(color(firstBtn, 'color'))}, radius ${color(firstBtn, 'borderRadius')}` : '',
        sections, footerColumns: footer ? Math.min(footer.querySelectorAll('ul').length, 8) : 0,
        imagery, fontStacks,
        bodyColor: hex(color(body, 'color')) || '#111111', linkColor: linkEl ? hex(color(linkEl, 'color')) : null,
        cardBackground: cardEl ? hex(color(cardEl, 'backgroundColor')) : null, cardBorder: cardEl ? hex(color(cardEl, 'borderColor')) : null,
        buttonColors: firstBtn ? { bg: hex(color(firstBtn, 'backgroundColor')), text: hex(color(firstBtn, 'color')), radius: color(firstBtn, 'borderRadius') } : null
      };
    });
    // Fonts: exact Google Fonts family when it exists, otherwise the closest free one measured against the real page.
    let resolvedFonts = {};
    try {
      const catalogue = await googleFonts.getCatalogue();
      const pageMeasure = (stack) => page.evaluate(measureWidths, { stack, samples: SAMPLES });
      const headingStack = snapshot.fontStacks?.h1 || snapshot.fontStacks?.h2 || snapshot.fontStacks?.body;
      resolvedFonts.heading = await resolveFontDynamic(headingStack, { catalogue, context, pageMeasure });
      resolvedFonts.body = snapshot.fontStacks?.body === headingStack ? resolvedFonts.heading : await resolveFontDynamic(snapshot.fontStacks?.body, { catalogue, context, pageMeasure });
    } catch { resolvedFonts = {}; }
    const style = deriveStyle(snapshot, resolvedFonts);
    return { brief: briefFromSnapshot(snapshot, url.href, style), image, style };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function capturePrototypeBrief(sourceUrl, options) {
  return (await captureInspiration(sourceUrl, options)).brief;
}

const PROTOTYPE_INSTRUCTIONS = `PROTOTYPE REFERENCE (structure and look only):
The user supplied an existing website as a PROTOTYPE. Use it to decide page structure, section order, layout patterns (grids, hero style, card rows), spacing density, colour palette and typography feel. Create the user's OWN website for the request above.
- Write original headings, copy and data that fit the user's request. Do NOT copy the prototype's brand name, text, logos, or images.
- Use placeholder-free content: realistic, specific copy for the user's business.
- Keep it a modular multi-page React site with working navigation.`;


/**
 * Adds the prototype colours/fonts to the Tailwind theme WITHOUT creating duplicate `colors`/`fontFamily` keys: in an
 * object literal the last duplicate wins, so a naive insert was silently overridden by the scaffold's own keys and the
 * prototype palette never reached Tailwind.
 */
function patchTailwindConfig(content, { body, heading, t }) {
  const proto = `proto: { bg: '${t.bg}', text: '${t.text}', primary: '${t.primary}', accent: '${t.accent}', surface: '${t.cardBg}', border: '${t.border}' }`;
  let out = content;
  if (/\bcolors\s*:\s*\{/.test(out)) out = out.replace(/\bcolors\s*:\s*\{/, `colors: { ${proto},`);
  else out = out.replace(/extend\s*:\s*\{/, `extend: {\n      colors: { ${proto} },`);
  const fonts = `sans: [${JSON.stringify(body)}], display: [${JSON.stringify(heading)}]`;
  if (/\bfontFamily\s*:\s*\{/.test(out)) {
    out = out.replace(/\bfontFamily\s*:\s*\{\s*sans\s*:\s*\[[^\]]*\]\s*,?/, 'fontFamily: {');
    out = out.replace(/\bfontFamily\s*:\s*\{/, `fontFamily: { ${fonts},`);
  } else out = out.replace(/extend\s*:\s*\{/, `extend: {\n      fontFamily: { ${fonts} },`);
  return out;
}

/** Makes the chosen fonts and colours real in the project: Google Fonts link, base typography and Tailwind theme. */
function applyPrototypeStyle(files, style) {
  if (!style?.fonts) return files;
  const families = [...new Set([style.fonts.heading.google, style.fonts.body.google].filter(Boolean))];
  if (!families.length) return files;
  const query = families.map((f) => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700`).join('&');
  const link = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?${query}&display=swap" rel="stylesheet" />`;
  const heading = `'${style.fonts.heading.google || style.fonts.body.google}', sans-serif`;
  const body = `'${style.fonts.body.google || style.fonts.heading.google}', sans-serif`;
  const t = style.tokens;
  const css = `\n/* Prototype look */\n:root{--proto-bg:${t.bg};--proto-text:${t.text};--proto-primary:${t.primary};--proto-accent:${t.accent};--proto-surface:${t.cardBg};--proto-border:${t.border};}\nbody{font-family:${body};background-color:var(--proto-bg);color:var(--proto-text);}\nh1,h2,h3,h4{font-family:${heading};}\n`;
  return files.map((file) => {
    if (file.path === 'index.html' && !file.content.includes('fonts.googleapis.com/css2')) {
      return { ...file, content: file.content.replace(/<\/head>/i, `    ${link}\n  </head>`) };
    }
    if (file.path === 'src/index.css' && !file.content.includes('Prototype look')) return { ...file, content: `${file.content.trimEnd()}\n${css}` };
    if (file.path === 'tailwind.config.js' && !file.content.includes('proto:')) {
      return { ...file, content: patchTailwindConfig(file.content, { body, heading, t }) };
    }
    return file;
  });
}

module.exports = { applyPrototypeStyle, patchTailwindConfig, deriveStyle, resolveFontDynamic, captureInspiration, capturePrototypeBrief, detectPrototypeUrl, PROTOTYPE_INSTRUCTIONS, briefFromSnapshot };
