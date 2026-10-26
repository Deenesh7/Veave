// Diagnoses WHY a blank region exists. Every candidate is a measurable relationship between one element's computed layout
// property and the measured gap (contribution <= gap), traced through the ancestor chain of both bordering elements.
// Pure: it only reads a snapshot, so the same evidence can be handed to the LLM and checked in tests.
const { AXES, px, round, median } = require('./geometry');
const { isContent } = require('./blankRegionDetector');

const BASE_WEIGHT = { 'box-model': 0.9, spacer: 0.85, 'height-constraint': 0.8, margin: 0.75, padding: 0.75, 'container-gap': 0.7, 'media-wrapper': 0.6, positioning: 0.6, 'grid-track': 0.55, 'flex-distribution': 0.55, transform: 0.5, 'hidden-content': 0.4, 'async-content': 0.4, 'flex-alignment': 0.3 };
const PATCHABLE = new Set(['box-model', 'spacer', 'height-constraint', 'margin', 'padding', 'container-gap', 'positioning', 'media-wrapper']);
const SPREAD = /^(center|flex-end|end|space-between|space-around|space-evenly)$/;

function buildIndex(snapshot) {
  const byId = new Map(snapshot.elements.map((el) => [el.id, el]));
  const kids = new Map();
  for (const el of snapshot.elements) { if (!kids.has(el.parent)) kids.set(el.parent, []); kids.get(el.parent).push(el); }
  const withContent = new Set();
  for (const el of snapshot.elements) if (isContent(el)) for (let id = el.id; id !== undefined && id !== -1 && !withContent.has(id); id = byId.get(id)?.parent) withContent.add(id);
  return { byId, kids, withContent };
}
const ancestors = (index, el) => { const out = []; for (let cur = el; cur; cur = index.byId.get(cur.parent)) out.push(cur); return out; };
const translateOf = (value) => { const m = String(value || '').match(/^matrix\(([^)]+)\)$/); if (!m) return { x: 0, y: 0 }; const v = m[1].split(',').map(Number); return { x: v[4] || 0, y: v[5] || 0 }; };
const describe = (el) => ({ path: el.path, tag: el.tag, cls: el.cls.slice(0, 160), label: el.label || undefined, text: el.text || undefined, rect: { top: round(el.rect.top), bottom: round(el.rect.bottom), left: round(el.rect.left), right: round(el.rect.right) } });
const hasHeightSource = (el) => px(el.style.minHeight) > 0 || /(^|\s)(?:[\w-]+:)*(?:min-)?h-/.test(el.cls) || /(?:^|;)\s*(?:min-)?height\s*:/i.test(el.inline);

/**
 * @returns { gap, target, excess, above, below, ancestors, candidates[] } - candidates are ranked best-first.
 */
function analyzeCause(snapshot, gap, { target, viewportWidth } = {}) {
  const index = buildIndex(snapshot);
  const ax = AXES[gap.axis];
  const typical = gap.typicalGap || 0;
  const goal = target ?? Math.min(96, Math.max(32, typical || 48));
  const excess = Math.max(0, gap.size - goal);
  const A = gap.above; const B = gap.below;
  const chainA = A ? ancestors(index, A) : [];
  const chainB = B ? ancestors(index, B) : [];
  const idsB = new Set(chainB.map((e) => e.id)); const idsA = new Set(chainA.map((e) => e.id));
  const lca = chainA.find((e) => idsB.has(e.id)) || null;
  const candidates = [];
  const usage = new Map();
  for (const el of snapshot.elements) if (el.cls) usage.set(el.cls, (usage.get(el.cls) || 0) + 1);

  const push = (type, el, property, amount, evidence, extra = {}) => {
    const contribution = Math.min(round(amount), gap.size);
    if (!(contribution >= Math.max(6, excess * 0.15))) return;
    candidates.push({ type, path: el.path, elementId: el.id, tag: el.tag, cls: el.cls, property, current: px(el.style[property]) || undefined, contribution, evidence, patchable: PATCHABLE.has(type), instances: usage.get(el.cls) || 1, ...extra });
  };
  const children = (el) => (index.kids.get(el.id) || []).filter((k) => k.style.position !== 'absolute' && k.style.position !== 'fixed');
  const sizeOf = (el) => el.rect[ax.end] - el.rect[ax.start];

  const classifySlack = (el, side, slack, chainSide) => {
    const parent = index.byId.get(el.parent);
    const evidence = [`${el.tag} is ${round(slack)}px larger than its content on the ${side} side`, `display:${el.style.display}`];
    if (el.style.overflowY !== 'visible' || el.style.overflowX !== 'visible') evidence.push(`overflow:${el.style.overflowY}/${el.style.overflowX} would clip content if the box shrank`);
    const sourceHint = hasHeightSource(el);
    const flexLike = /flex|grid/.test(el.style.display);
    const spreads = flexLike && (SPREAD.test(el.style.justifyContent) || SPREAD.test(el.style.alignItems) || SPREAD.test(el.style.alignContent));
    if (parent && /grid/.test(parent.style.display) && !sourceHint) {
      push('grid-track', el, 'gridTemplateRows', slack, [...evidence, `grid item in a grid with rows "${parent.style.gridTemplateRows}" and auto rows "${parent.style.gridAutoRows}" (${parent.path})`], { owner: parent.path });
      return;
    }
    if (el.style.aspectRatio && el.style.aspectRatio !== 'auto' && el.rect.height > 0) {
      push('media-wrapper', el, 'aspectRatio', slack, [...evidence, `aspect-ratio ${el.style.aspectRatio} reserves a fixed box`]);
      return;
    }
    if (children(el).some((k) => k.replaced) && !sourceHint && el.style.position === 'relative') {
      push('media-wrapper', el, 'height', slack, [...evidence, 'wrapper around media with its own sizing']);
      return;
    }
    const property = px(el.style.minHeight) > 0 && ax.name === 'y' ? 'minHeight' : (ax.name === 'y' ? 'height' : 'width');
    push('height-constraint', el, ax.name === 'y' ? property : 'minWidth', slack, [...evidence, sourceHint ? `explicit size: min-height ${el.style.minHeight}, height ${el.style.height}` : 'size not explained by padding or content'], { explicit: sourceHint, sideOfGap: chainSide });
    if (spreads) push('flex-alignment', el, 'justifyContent', slack, [...evidence, `content is pushed by justify-content:${el.style.justifyContent} / align-items:${el.style.alignItems} inside the reserved size`], { sideOfGap: chainSide });
    if (/media|image|picture/i.test(el.tag) === false && parent && /flex/.test(parent.style.display) && px(el.style.flexGrow) > 0) push('flex-distribution', el, 'flexGrow', slack, [...evidence, `flex-grow:${el.style.flexGrow} stretches this item inside ${parent.path}`]);
  };

  // 1 + 2: ancestor chains. Padding/margin that sit inside the band, and slack that no padding or margin explains.
  const walkSide = (chain, sideName, own) => {
    for (const el of chain) {
      if (own === 'end' ? idsB.has(el.id) : idsA.has(el.id)) break; // shared ancestors do not own the gap
      const ref = own === 'end' ? gap.start : gap.end;
      const reach = own === 'end' ? el.rect[ax.end] - ref : ref - el.rect[ax.start]; // box edge distance from the content edge into the band
      if (reach < 0 || reach > gap.size + 2) continue;
      const pad = px(el.style[own === 'end' ? ax.paddingEnd : ax.paddingStart]) + px(el.style[own === 'end' ? ax.borderEnd : ax.borderStart]);
      const margin = px(el.style[own === 'end' ? ax.marginEnd : ax.marginStart]);
      if (pad > 0) push('padding', el, own === 'end' ? ax.paddingEnd : ax.paddingStart, Math.min(pad, reach), [`${sideName} padding ${pad}px lies between the content and the ${own === 'end' ? 'bottom' : 'top'} edge of ${el.tag}`]);
      if (margin > 0 && (own === 'end' ? el.rect[ax.end] >= gap.start - 2 : el.rect[ax.start] <= gap.end + 2)) push('margin', el, own === 'end' ? ax.marginEnd : ax.marginStart, margin, [`${sideName} margin ${margin}px sits in the band`], { margin: true });
      // Box model: under content-box, min-height AND padding add up (typical for aspect-ratio boxes that also carry a min-height),
      // so the box is taller than any content it holds. border-box would make the same declarations agree.
      {
        const padTotal = px(el.style[ax.paddingStart]) + px(el.style[ax.paddingEnd]) + px(el.style[ax.borderStart]) + px(el.style[ax.borderEnd]);
        const minSize = px(el.style[ax.minSize]);
        if (el.style.boxSizing === 'content-box' && minSize > 0 && padTotal > 0 && Math.abs(sizeOf(el) - (minSize + padTotal)) <= 2) {
          const flow = children(el);
          const contentSize = flow.length ? Math.max(...flow.map((k) => k.rect[ax.end])) - Math.min(...flow.map((k) => k.rect[ax.start])) : 0;
          const saved = sizeOf(el) - Math.max(minSize, padTotal + contentSize);
          if (saved > 0) push('box-model', el, 'boxSizing', saved, [`box-sizing:content-box adds ${round(padTotal)}px of padding on top of min-height ${round(minSize)}px (${round(sizeOf(el))}px tall) while its content needs only ${round(Math.max(minSize, padTotal + contentSize))}px`, 'the same declarations agree under box-sizing:border-box'], { explicit: true });
        }
      }
      const inner = children(el);
      if (inner.length && !el.hasText && reach >= 0.5) {
        const extent = own === 'end' ? Math.max(...inner.map((k) => k.rect[ax.end] + px(k.style[ax.marginEnd]))) : Math.min(...inner.map((k) => k.rect[ax.start] - px(k.style[ax.marginStart])));
        const slack = own === 'end' ? el.rect[ax.end] - pad - extent : extent - (el.rect[ax.start] + pad);
        if (slack >= 8) classifySlack(el, own === 'end' ? 'bottom' : 'top', slack, sideName);
      }
      // transforms and offsets that move the box away from its neighbour
      const t = translateOf(el.style.transform);
      const moved = own === 'end' ? -t[ax.name] : t[ax.name];
      if (moved > 0) push('transform', el, 'transform', moved, [`transform translate${ax.name.toUpperCase()} shifts ${el.tag} by ${round(moved)}px away from its neighbour`]);
      if (own === 'start' && el.style.position === 'relative' && px(el.style[ax.inset]) > 0) push('positioning', el, ax.inset, px(el.style[ax.inset]), [`position:relative offset ${ax.inset}:${el.style[ax.inset]} pushes the element ${px(el.style[ax.inset])}px`]);
    }
  };
  walkSide(chainA, 'above', 'end');
  walkSide(chainB, 'below', 'start');

  // 3: elements that live inside the band and hold no content (spacers, reserved placeholders, hidden or pending content)
  const inBand = snapshot.elements.filter((el) => el.rect[ax.start] >= gap.start - 1 && el.rect[ax.end] <= gap.end + 1 && !idsA.has(el.id) && !idsB.has(el.id) && sizeOf(el) >= 6);
  const bandIds = new Set(inBand.map((e) => e.id));
  for (const el of inBand) {
    if (bandIds.has(el.parent) && !(index.byId.get(el.parent) && index.withContent.has(el.parent))) continue; // keep the outermost empty box only
    if (el.hidden && (el.hasText || el.replaced || (index.kids.get(el.id) || []).length)) { push('hidden-content', el, 'visibility', sizeOf(el), [`hidden (visibility:${el.style.visibility}, opacity:${el.style.opacity}) content still reserves ${round(sizeOf(el))}px`]); continue; }
    if (el.pending || el.busy) { push('async-content', el, 'height', sizeOf(el), [`${el.pending ? 'image has not loaded' : 'placeholder/skeleton markup'} but its space is reserved`]); continue; }
    if (index.withContent.has(el.id)) continue;
    push('spacer', el, ax.name === 'y' ? 'height' : 'width', sizeOf(el) + px(el.style[ax.marginStart]) + px(el.style[ax.marginEnd]), [`${el.tag} holds no visible content but occupies ${round(sizeOf(el))}px inside the gap`], { explicit: hasHeightSource(el) });
  }

  // 4: spacing owned by the shared container (gap property, distribution of free space)
  if (lca && A && B) {
    const cA = chainA.find((e) => e.parent === lca.id); const cB = chainB.find((e) => e.parent === lca.id);
    const gapValue = px(lca.style[ax.gap]);
    const grid = /grid/.test(lca.style.display);
    const flexMain = /flex/.test(lca.style.display) && ((ax.name === 'y') === /column/.test(lca.style.flexDirection || 'row'));
    if (cA && cB && gapValue > 0 && (grid || flexMain || (/flex/.test(lca.style.display) && lca.style.flexWrap !== 'nowrap' && ax.name === 'y'))) push('container-gap', lca, ax.gap, gapValue, [`${lca.style.display} container applies ${ax.gap}:${gapValue}px between ${cA.path} and ${cB.path}`], { owner: lca.path });
    if (cA && cB && flexMain && /space-(between|around|evenly)/.test(lca.style.justifyContent)) {
      const own = (cB.rect[ax.start] - px(cB.style[ax.marginStart])) - (cA.rect[ax.end] + px(cA.style[ax.marginEnd])) - gapValue;
      if (own > 0) push('flex-distribution', lca, 'justifyContent', own, [`justify-content:${lca.style.justifyContent} distributes ${round(own)}px of free space between siblings`], { owner: lca.path });
    }
  }

  // rank
  const ranked = candidates.map((c) => {
    const coverage = excess > 0 ? Math.min(1, c.contribution / excess) : 1;
    let score = (BASE_WEIGHT[c.type] || 0.3) * (0.4 + 0.6 * coverage);
    const reasons = [`covers ${Math.round(coverage * 100)}% of the ${round(excess)}px excess`];
    if (c.explicit || c.margin || c.type === 'padding') { score += 0.08; reasons.push('property is set directly on the element'); }
    if (c.instances > 1) { score -= 0.08; reasons.push(`style shared by ${c.instances} elements (side effects possible)`); }
    if (!c.patchable) { score -= 0.15; reasons.push('no safe automatic patch for this cause'); }
    c.score = Math.max(0, Math.min(1, round(score * 100) / 100));
    c.confidence = c.score >= 0.7 ? 'high' : c.score >= 0.45 ? 'medium' : 'low';
    c.expectedGapAfter = round(Math.max(goal, gap.size - Math.min(c.contribution, excess)));
    c.rationale = reasons;
    return c;
  });
  // the same element/property reached from both chains must not be listed twice
  const seen = new Set();
  const unique = ranked.sort((a, b) => b.score - a.score || b.contribution - a.contribution).filter((c) => { const k = `${c.type}:${c.path}:${c.property}`; if (seen.has(k)) return false; seen.add(k); c.key = k; return true; });
  return {
    gap: { id: gap.id, axis: gap.axis, size: gap.size, start: round(gap.start), end: round(gap.end), edge: gap.edge || null },
    target: goal, excess: round(excess), viewport: snapshot.viewport, breakpoint: snapshot.breakpoint,
    above: A && describe(A), below: B && describe(B),
    ancestors: { above: chainA.map(describe).slice(0, 8), below: chainB.map(describe).slice(0, 8), shared: lca ? lca.path : null },
    candidates: unique.slice(0, 12)
  };
}

module.exports = { analyzeCause, buildIndex, BASE_WEIGHT, PATCHABLE };
