/**
 * The design vocabulary shared by the planner (which chooses from it), the generation prompt (which spells it out) and the
 * visual review (which measures against it). One place, so the three can never disagree.
 */

// Tailwind classes for the spacing / typography scale the generator must use. Between two sections the gap is the sum of the
// bottom padding of the first and the top padding of the second.
const TOKENS = {
  container: { wide: 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', standard: 'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8', narrow: 'mx-auto w-full max-w-3xl px-4 sm:px-6' },
  section: {
    hero: 'pt-10 pb-10 md:pt-16 md:pb-14',        // first screen: content-sized, never min-h-screen
    major: 'py-10 md:py-14',                      // 80-112px between major sections
    related: 'py-8 md:py-10',                     // 64-80px between related sections
    compact: 'py-6 md:py-8'                       // short content (a strip, a call to action)
  },
  stack: { eyebrowToHeading: 'mb-3', headingToParagraph: 'mt-4 md:mt-5', paragraphToNext: 'mt-5 md:mt-6', paragraphs: 'space-y-4', cardPadding: 'p-5 md:p-6', grid: 'gap-6 md:gap-8' },
  type: {
    eyebrow: 'text-xs font-semibold uppercase tracking-[0.14em]',
    h1: 'text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight',
    h2: 'text-2xl md:text-3xl font-semibold leading-snug tracking-tight',
    h3: 'text-lg md:text-xl font-semibold leading-snug',
    body: 'text-base leading-7',
    lead: 'text-lg leading-8',
    caption: 'text-sm leading-6'
  },
  prose: 'max-w-[68ch]'
};

// layout id -> what it is for, how it is built, how many pictures it takes and how it behaves on small screens.
const LAYOUTS = {
  'split-hero': { use: 'home or landing hero with a strong picture', build: 'two columns on lg (text left, picture right, items-center), picture in an aspect-[4/3] frame; stacked on mobile with the picture BELOW the text; hero padding from the hero token; no min-h-screen', images: [1, 1], width: 'wide', spacing: 'hero', mobile: 'stack, text first' },
  'full-width-hero': { use: 'page opening with one wide photograph', build: 'a wide aspect-[21/9] (aspect-[4/3] on mobile) rounded photograph with a short heading and one lead paragraph above or over it; content-sized, no fixed height', images: [1, 1], width: 'wide', spacing: 'hero', mobile: 'photograph first, shorter ratio' },
  'page-intro': { use: 'inner-page opening: eyebrow, H1, one short lead paragraph', build: 'left-aligned in a narrow container, compact padding, no picture or a small one; never a tall banner', images: [0, 1], width: 'narrow', spacing: 'compact', mobile: 'same, smaller type' },
  'editorial-image-right': { use: 'story, explanation or biography passage with one supporting photograph', build: 'grid lg:grid-cols-2 gap-8 md:gap-12 items-center; text column in a prose width; picture in an aspect-[4/3] frame with a caption', images: [1, 1], width: 'wide', spacing: 'major', mobile: 'picture below the text' },
  'editorial-image-left': { use: 'same as editorial-image-right, alternated for rhythm', build: 'mirrored columns; the picture comes first in the markup only when it introduces the text, otherwise use lg:order-first', images: [1, 1], width: 'wide', spacing: 'major', mobile: 'picture below the text' },
  'two-column': { use: 'two related text blocks or a text block with a fact list', build: 'grid md:grid-cols-2 gap-8, each column a heading plus short paragraphs or a list', images: [0, 0], width: 'standard', spacing: 'related', mobile: 'stack' },
  'three-column-cards': { use: 'services, features, values: three or four parallel items', build: 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8; equal cards (rounded border, card padding), each with an optional small picture in an aspect-[4/3] frame, an H3 and 1-2 sentences', images: [0, 4], width: 'wide', spacing: 'major', mobile: 'one column' },
  timeline: { use: 'milestones with dates (career, history, process)', build: 'a vertical line with date + heading + 1-2 sentence entries; entries alternate sides only on lg; photographs only where one belongs to a specific entry', images: [0, 3], width: 'standard', spacing: 'major', mobile: 'single column along the line' },
  statistics: { use: 'three to four headline numbers', build: 'a compact row (grid grid-cols-2 lg:grid-cols-4 gap-6), large number + short label, compact padding', images: [0, 0], width: 'wide', spacing: 'compact', mobile: '2 x 2' },
  'achievement-grid': { use: 'awards, recognitions, honours', build: 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6; each card has the year/eyebrow, the award as H3, the awarding body and one sentence; a photograph only when it documents that award', images: [0, 4], width: 'wide', spacing: 'major', mobile: 'one column' },
  gallery: { use: 'a set of photographs of one subject', build: 'responsive grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4, every tile the same aspect ratio with object-cover and a short caption', images: [3, 9], width: 'wide', spacing: 'major', mobile: '2 columns' },
  testimonial: { use: 'one to three quotations', build: 'quote in a prose width with name and role beneath; a small portrait only when it is verified', images: [0, 3], width: 'standard', spacing: 'related', mobile: 'stack' },
  profile: { use: 'a person or an institution: portrait/photograph beside who they are', build: 'grid md:grid-cols-[minmax(0,320px)_1fr] gap-8 md:gap-12; portrait in an aspect-[4/5] frame object-top; beside it a name H2, a role line, two short paragraphs and a fact list', images: [1, 1], width: 'wide', spacing: 'major', mobile: 'portrait first, max-w-xs' },
  'alternating-editorial': { use: 'three or more related passages that each deserve a picture', build: 'stacked editorial rows, alternating image side, each row editorial-image-left/right sized; related spacing between rows', images: [2, 4], width: 'wide', spacing: 'related', mobile: 'stack' },
  'text-block': { use: 'plain explanatory text', build: 'one prose-width column (max-w-[68ch]) with an H2, an optional lead and 2-4 short paragraphs or a bullet list; no picture slot', images: [0, 0], width: 'narrow', spacing: 'related', mobile: 'same' },
  'contact-split': { use: 'contact page body', build: 'two columns: form (labels, fields, button) and contact details with address/phone/email/hours; no tall decorative areas', images: [0, 1], width: 'standard', spacing: 'major', mobile: 'stack, details first' },
  'cta-band': { use: 'closing call to action', build: 'a compact band: one H2, one sentence, one or two buttons, centred in a narrow container', images: [0, 0], width: 'narrow', spacing: 'compact', mobile: 'same' },
  'faq-list': { use: 'questions and answers', build: 'a single column of details/summary items in a prose width', images: [0, 0], width: 'narrow', spacing: 'related', mobile: 'same' }
};

// Content length by words: what a section of each size looks like (used to size containers and judge density).
const CONTENT_LENGTH = { none: 0, brief: 30, short: 70, medium: 140, long: 260 };

// Rendered-layout thresholds (CSS pixels). Blocking kinds are the ones that are unmistakably defects.
const REVIEW = {
  maxGapDesktop: 280,       // empty vertical space between the content of two neighbouring sections
  maxGapTablet: 240,
  maxGapMobile: 180,
  gapOutlierFactor: 2.4,    // ... or this many times the page's typical gap
  minBlockingGap: 200,
  emptyContainerMinHeight: 140,
  maxCharsPerLine: 88,
  minCharsPerLine: 38,
  imageDominates: 0.85,     // image height as a share of the viewport height
  cardHeightSpread: 1.7,
  maxFontSizes: 10,
  narrowShare: 0.5,         // text column narrower than this share of the screen, on most sections
  blocking: ['layout-gap', 'layout-empty', 'layout-overflow-x', 'layout-no-scroll']
};

const VIEWPORTS = { desktop: { name: 'desktop', width: 1440, height: 900 }, tablet: { name: 'tablet', width: 820, height: 1180 }, mobile: { name: 'mobile', width: 390, height: 844 } };

module.exports = { TOKENS, LAYOUTS, CONTENT_LENGTH, REVIEW, VIEWPORTS };
