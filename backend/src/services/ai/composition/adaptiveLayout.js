/**
 * AdaptiveLayoutEngine: chooses how a section is laid out from what it will really contain, before it is written.
 *
 * The composition planner picks a layout from the planned length of a section. That is a guess about content that does not exist yet.
 * Once the sources have been read, the real number of items is known (courses, milestones, awards, facilities), so the layout is
 * decided again from it:
 *   - the layout follows the MEANING of the content (a person: portrait + biography; history: timeline; courses: categorised
 *     programme grids; facilities: image-text features; awards: a grid or a timeline) and
 *   - the number of columns follows the NUMBER of items, so a grid never has an empty slot, a timeline never leaves half the width
 *     unused, and an image box is only reserved when a picture exists.
 * The decision becomes `section.adaptive` (stored with the plan) and an exact instruction for the writer (class names included).
 * Pure functions.
 */
const { LAYOUTS } = require('./layoutCatalog');
const { entriesFor } = require('../knowledge/knowledgeExtractor');

const TWO_SIDED_MIN = 6;      // a two-sided timeline needs this many entries to fill both sides
const LIST_MIN = 13;          // more items than this read better as a compact list than as cards

/** Tailwind classes for a grid or wrapped row of `n` items so that the last row is never left with a hole on one side. */
function gridFor(n, { textHeavy = false } = {}) {
  const centred = 'flex flex-wrap justify-center gap-6 [&>*]:w-full sm:[&>*]:w-[calc(50%-0.75rem)] lg:[&>*]:w-[calc(33.333%-1rem)]';
  if (n <= 0) return { columns: 0, className: '', note: 'no items: do not render a grid' };
  if (n === 1) return { columns: 1, className: 'grid grid-cols-1 gap-6 max-w-2xl mx-auto', note: 'one item: a single full-width card, centred' };
  if (n === 2) return { columns: 2, className: 'grid grid-cols-1 sm:grid-cols-2 gap-6', note: 'two items: two equal columns' };
  if (n === 3) return { columns: 3, className: 'grid grid-cols-1 md:grid-cols-3 gap-6', note: 'three items: three equal columns on desktop' };
  if (n === 4) return textHeavy ? { columns: 2, className: 'grid grid-cols-1 sm:grid-cols-2 gap-6', note: 'four text-heavy items: a two-by-two grid' } : { columns: 4, className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6', note: 'four items: two-by-two on tablets, four across on desktop' };
  if (n === 5) return { columns: 3, className: centred, note: 'five items: rows of three with the last row centred (no empty slots)' };
  if (n === 6) return { columns: 3, className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6', note: 'six items: three columns' };
  if (n <= 12) {
    if (n % 4 === 0 && !textHeavy) return { columns: 4, className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6', note: `${n} items: four columns, every row full` };
    if (n % 3 === 0) return { columns: 3, className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6', note: `${n} items: three columns, every row full` };
    return { columns: 3, className: centred, note: `${n} items: rows of three with the last row centred (no empty slots)` };
  }
  return { columns: 3, className: 'columns-1 sm:columns-2 lg:columns-3 gap-x-8 [&>*]:break-inside-avoid [&>*]:mb-3', note: `${n} items: a compact multi-column list, not ${n} cards` };
}

/** How many items a section holds: the verified entries of its requirements, else the facts the plan gave it. */
function itemCountFor(section, requirements, knowledge) {
  const mine = (requirements || []).filter((item) => (section.requirementIds || []).includes(item.id));
  const sourced = mine.reduce((sum, item) => sum + entriesFor(knowledge, item.id).length, 0);
  return sourced || (section.facts || []).length || 0;
}

/** Groups of a catalogue (undergraduate / postgraduate / ...), each with its own count. */
function groupsFor(section, requirements, knowledge) {
  const groups = new Map();
  for (const item of (requirements || []).filter((req) => (section.requirementIds || []).includes(req.id))) {
    for (const entry of entriesFor(knowledge, item.id)) {
      const key = entry.attributes?.group || entry.attributes?.level || item.label;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
  }
  return [...groups].map(([name, count]) => ({ name, count }));
}

/**
 * @param input { kind (contentKind), count, hasImage, groups }
 * @returns {{ layout, mode, columns, gridClass, notes[] }}
 */
function decide({ kind = 'narrative', count = 0, hasImage = false, groups = [] } = {}) {
  const notes = [];
  if (kind === 'person') return { layout: 'profile', mode: hasImage ? 'portrait-and-biography' : 'biography-with-monogram', columns: hasImage ? 2 : 1, gridClass: '', notes: [hasImage ? 'portrait beside the biography in two balanced columns (items-start), stacked on mobile' : 'no picture exists: a single-column biography with a small monogram, no empty image frame'] };
  if (kind === 'timeline') {
    if (count === 0) return { layout: 'text-block', mode: 'narrative', columns: 1, gridClass: '', notes: ['no dated milestones were retrieved: write a short general history in prose, no timeline'] };
    if (count <= 2) return { layout: 'text-block', mode: 'dated-list', columns: 1, gridClass: '', notes: [`${count} milestone(s): a short dated list, not a timeline`] };
    if (count < TWO_SIDED_MIN) return hasImage
      ? { layout: 'timeline', mode: 'split-image', columns: 2, gridClass: 'grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start', notes: [`${count} milestones: the timeline fills one column and the picture the other (both columns carry content, aligned to the top); stacked on mobile`] }
      : { layout: 'timeline', mode: 'single', columns: 1, gridClass: 'max-w-3xl mx-auto', notes: [`${count} milestones: one centred single-column timeline with the marker line on the left`] };
    return { layout: 'timeline', mode: 'two-sided', columns: 2, gridClass: 'relative grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8', notes: [`${count} milestones: entries alternate left and right of a centre line on desktop; single column on mobile`] };
  }
  if (kind === 'achievements') {
    if (count === 0) return { layout: 'text-block', mode: 'narrative', columns: 1, gridClass: '', notes: ['no sourced awards: a short general statement, no award grid and no numbers'] };
    if (count <= 2) return { layout: 'two-column', mode: 'list', columns: count, gridClass: gridFor(count).className, notes: [`${count} award(s): shown as ${count === 1 ? 'one featured card' : 'two equal cards'}`] };
    return { layout: 'achievement-grid', mode: 'grid', columns: gridFor(count).columns, gridClass: gridFor(count, { textHeavy: true }).className, notes: [gridFor(count).note] };
  }
  if (kind === 'catalogue') {
    if (count === 0) return { layout: 'text-block', mode: 'narrative', columns: 1, gridClass: '', notes: ['no verified items: say what is offered in general terms, no cards, no invented list'] };
    const sized = (groups.length ? groups : [{ name: 'Items', count }]).map((group) => ({ ...group, ...gridFor(group.count, { textHeavy: true }), list: group.count >= LIST_MIN }));
    return { layout: 'three-column-cards', mode: 'categorised-grid', columns: Math.max(...sized.map((group) => group.columns)), gridClass: '', groups: sized.map(({ name, count: n, className, list, note }) => ({ name, count: n, className, list, note })), notes: [`${count} items in ${sized.length} categor${sized.length === 1 ? 'y' : 'ies'}: each category has its own heading and a grid sized to ITS number of items`] };
  }
  if (kind === 'facilities') {
    if (count >= 3 && hasImage) return { layout: 'alternating-editorial', mode: 'image-text-features', columns: 2, gridClass: '', notes: [`${count} facilities: alternating image-text feature rows (picture only where one exists for that facility)`] };
    if (count >= 3) return { layout: 'three-column-cards', mode: 'grid', columns: gridFor(count).columns, gridClass: gridFor(count).className, notes: [gridFor(count).note] };
    return { layout: hasImage ? 'editorial-image-right' : 'two-column', mode: 'editorial', columns: 2, gridClass: '', notes: [`${count || 'few'} facilit${count === 1 ? 'y' : 'ies'}: an editorial section`] };
  }
  if (kind === 'contact') return { layout: 'contact-split', mode: 'split', columns: 2, gridClass: '', notes: [] };
  return { layout: hasImage ? 'editorial-image-right' : 'two-column', mode: hasImage ? 'editorial' : 'two-column-text', columns: hasImage ? 2 : 1, gridClass: '', notes: [hasImage ? 'text beside its picture' : 'no picture: full-width text in two readable columns or one column of at most 68ch, never an empty image frame'] };
}

/**
 * Applies the decision to every section a requirement maps to (mutates the plan). Sections that carry no tracked requirement keep the
 * planner's layout. Returns the decisions for the job record.
 */
function adaptPlan({ plan, requirements = [], knowledge = null, assets = [], finalPass = false }) {
  const decisions = [];
  for (const page of plan.pages) for (const section of page.sections) {
    const mine = requirements.filter((item) => (section.requirementIds || []).includes(item.id));
    if (!mine.length) continue;
    // The strongest kind among the requirements of the section decides; a section about a person stays a profile.
    const order = ['person', 'catalogue', 'timeline', 'achievements', 'facilities', 'contact', 'narrative'];
    const kind = order.find((name) => mine.some((item) => item.contentKind === name)) || 'narrative';
    const count = itemCountFor(section, requirements, knowledge);
    // Before pictures are found a section keeps the slot it planned; after the pictures are checked only a section that really has one does.
    const hasImage = finalPass ? assets.some((asset) => asset.sectionId === section.id && (kind !== 'person' || asset.entityType === 'person')) : Boolean(section.images?.length) && (kind !== 'person' || assets.some((asset) => asset.sectionId === section.id || (asset.entityType === 'person' && section.images.some((need) => need.entity && String(need.entity).toLowerCase() === String(asset.entity).toLowerCase()))));
    const groups = kind === 'catalogue' ? groupsFor(section, requirements, knowledge) : [];
    const decision = decide({ kind, count, hasImage, groups });
    section.adaptive = { kind, itemCount: count, ...decision };
    if (LAYOUTS[decision.layout]) { section.layout = decision.layout; section.width = LAYOUTS[decision.layout].width; section.spacing = LAYOUTS[decision.layout].spacing; }
    // A section without a picture reserves no picture slot.
    if (!hasImage && kind !== 'person' && (finalPass || !section.images?.length)) section.images = [];
    if (kind === 'catalogue' || (kind === 'timeline' && count >= 3)) section.words = 'long';
    decisions.push({ page: page.name, section: section.heading, kind, itemCount: count, layout: decision.layout, mode: decision.mode, columns: decision.columns, notes: decision.notes });
  }
  return decisions;
}

/** The instruction the writer gets for one section (empty when the planner's layout stands). */
function layoutInstruction(section) {
  const a = section.adaptive;
  if (!a) return '';
  const lines = [`LAYOUT DECISION (computed from the ${a.itemCount ? `${a.itemCount} real item(s)` : 'actual content'} of this section: follow it exactly): layout "${a.layout}", mode "${a.mode}".`];
  for (const note of a.notes || []) lines.push(`  - ${note}`);
  if (a.groups?.length) {
    for (const group of a.groups) lines.push(`  - category "${group.name}" (${group.count} item${group.count === 1 ? '' : 's'}): ${group.list ? `a compact list with wrapper class "${group.className}"` : `cards in a wrapper with class "${group.className}"`} (${group.note})`);
  } else if (a.gridClass) lines.push(`  - wrapper class: "${a.gridClass}"`);
  if (a.mode === 'two-sided') lines.push('  - timeline: a vertical centre line on lg with entries alternating left and right, markers on the line; on small screens one column with the line on the left');
  if (a.mode === 'single') lines.push('  - timeline: one column, vertical line on the left, a dated marker per entry, each entry full width of the column; NO empty second column');
  if (a.mode === 'split-image') lines.push('  - timeline column and picture column are the same height class (items-start); the picture is sticky-free and sized by aspect ratio, never taller than the timeline');
  lines.push('  - never render an empty card, an empty image frame, a grid column with nothing in it, or a fixed/minimum height; the section is exactly as tall as its content');
  return lines.join('\n');
}

module.exports = { adaptPlan, decide, gridFor, layoutInstruction, itemCountFor, groupsFor, TWO_SIDED_MIN, LIST_MIN };
