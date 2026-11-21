/**
 * The prompt for regenerating ONE page of a template site. It shows the model the page's current code in full, the few shared
 * pieces it needs to know (tokens, shared component sources), the other pages by name only (so it does not repeat them), and the
 * exact rules for what it may change. Nothing about the rest of the website is sent, which keeps the request small and the change local.
 */
const templateService = require('../templates/templateService');

const SHARED_SOURCE_LIMIT = 3500;
const FILE_LIMIT = 24000;

const fence = (path, content, limit = FILE_LIMIT) => `// File: ${path}\n${String(content).length > limit ? `${String(content).slice(0, limit)}\n// ... (shortened)` : content}`;

function tokenSummary(template) {
  const tokens = templateService.tokensFromTemplate(template);
  return [
    `Mood: ${tokens.mood || template.designTokens?.mood || ''}`,
    'Use the semantic Tailwind colours only (bg-bg, bg-surface, bg-surface-2, border-line, text-fg, text-muted, bg-brand, text-on-brand); do not hard-code colours.',
    `Headings: ${template.typography?.headingFont || 'the template heading font'}; body: ${template.typography?.bodyFont || 'the template body font'}. ${template.typography?.scale || ''}`.trim(),
    `Layout: ${template.layout?.summary || ''}. Container: ${template.layout?.container || ''}. Section spacing: ${template.spacing?.section || ''}.`,
    `Responsive: ${template.responsive?.summary || ''}`
  ].filter(Boolean).join('\n');
}

const PLACEMENT_LABEL = { hero: 'the hero / main banner image', about: 'the About / introduction section', gallery: 'a gallery', project: 'a project or portfolio card (its cover image)', background: 'a section background image', 'page-background': 'the background of the WHOLE page (behind every section of this page)', section: 'the section named in the note' };

/** One line per uploaded picture: its path, size, what it shows and where the owner wants it. */
function photoBlock(attachments) {
  const lines = attachments.map((photo) => {
    const details = [
      photo.width && photo.height ? `${photo.width}x${photo.height}px, ${photo.width >= photo.height ? 'landscape' : 'portrait'}` : '',
      photo.caption ? `shows: ${photo.caption}` : '',
      photo.tags?.length ? `subjects: ${photo.tags.join(', ')}` : '',
      photo.placement ? `OWNER WANTS IT AS: ${String(photo.placement).startsWith('section:') ? `placed in the "${String(photo.placement).slice(8)}" section of this page (only in that section; if the owner note says "background", use it as that section's background)` : (PLACEMENT_LABEL[photo.placement] || photo.placement)}` : '',
      photo.note ? `owner note: "${photo.note}"` : ''
    ].filter(Boolean).join('; ');
    return `- <img src="${photo.path}" ...>  (file "${photo.name}"${details ? `; ${details}` : ''})`;
  }).join('\n');
  return `USER PHOTOS (the user uploaded these pictures for this change; they are already in the site):\n${lines}\nPlace every photo where its OWNER WANTS IT AS / owner note / the instruction says. If none says, put each photo in the section whose subject matches what it shows. Use each photo exactly once with its exact path and a meaningful alt text (use the description above). An ordinary photo goes in a fixed-aspect frame (aspect-[4/3], aspect-square or aspect-video) with w-full h-full object-cover, and loading="lazy" below the fold.
WHOLE-PAGE BACKGROUND: when a photo is wanted as the background of the whole page (OWNER WANTS IT AS the background of the WHOLE page, or the instruction says so), wrap the page's content in a root <div className="relative isolate min-h-screen"> whose first child is <img src="EXACT_PATH" alt="" aria-hidden="true" className="fixed inset-0 -z-10 h-full w-full object-cover" /> followed by a readability overlay <div className="fixed inset-0 -z-10 bg-black/40" aria-hidden="true" />. Then make this page's own sections see-through so the picture shows: remove their solid background colours or use a translucent one (for example bg-bg/70 with backdrop-blur-sm on cards and panels) and switch their text to colours that stay readable on the photo. This background belongs to THIS page only: put it only in this page's own file, never in a shared component, the layout, the navigation, the footer, src/index.css, the body/html element or any other page, so every other page of the website keeps its own look. The picture must cover the page at every screen width, never repeat and never stretch.
BACKGROUND PHOTOS: when a photo is wanted as a background (OWNER WANTS IT AS a section background image, or the owner note or the instruction says "background"), do NOT put it in a framed card. Make that section's wrapper "relative isolate overflow-hidden" with a min height that suits its content (for example min-h-[60vh] for a hero), put the photo as the first child <img src="EXACT_PATH" alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover" />, add a dark/brand overlay sibling <div className="absolute inset-0 -z-10 bg-black/45" aria-hidden="true" /> (or a gradient) so the text stays readable, and keep the section's content in a normal Container above it with light text colours that stay readable on the photo. The picture must fill the whole section on every screen width, never repeat, never stretch, and the section's existing text and buttons must remain. Never change a path, never swap a photo for another picture, and never leave out a photo that is listed here.`;
}

/**
 * Website-level context, the same for every page of one website: what the website is for, and what the other pages and the pages
 * already written in this run say, so each page keeps the same voice and does not repeat another page.
 */
function themeBlock(theme) {
  if (!theme) return '';
  const parts = [];
  const t = theme.typography;
  if (t) parts.push(`typography: headings ${t.headingFont || 'template font'} ${t.headingWeight}, body ${t.bodyFont || 'template font'} ${t.bodyWeight}, line height ${t.bodyLineHeight}`);
  if (theme.colors) parts.push(`colours: ${Object.entries(theme.colors).map(([key, value]) => `${key} ${value}`).join(', ')}`);
  if (theme.appearance) parts.push(`appearance: ${Object.entries(theme.appearance).map(([key, value]) => `${key} ${value}`).join(', ')}`);
  return `THEME CHOSEN BY THE OWNER (already applied to the whole website through its design tokens and CSS; it is final): ${parts.join('; ')}. Use only the semantic Tailwind colour classes and the font utilities (font-serif for headings, font-sans for body); never hard-code colours or font families, and never change the fonts or colours of this page.`;
}

function websiteBlock({ name = '', brief = '', theme = null, pages = [], written = [], plan = null, page = null, mode = 'edit' }) {
  const lines = [`WEBSITE${name ? ` "${name}"` : ''} (every page below belongs to this one website and must share its voice, vocabulary and visual language):`];
  if (brief) lines.push(`WEBSITE BRIEF from the owner (this is what the website is; it applies to every page, so do not ask for it again):\n${String(brief).trim().slice(0, 4000)}`);
  if (theme) lines.push(themeBlock(theme));
  if (plan) {
    const identity = plan.identity || {};
    lines.push([
      `WEBSITE PLAN (already decided for this website; follow it):`,
      `- Kind of website: ${identity.category}${identity.organizationType ? ` (${identity.organizationType})` : ''}. Name: ${identity.name}${identity.namePlaceholder ? ' (a generic name: the owner has not given one)' : ''}.`,
      identity.purpose ? `- Purpose: ${identity.purpose}` : '',
      identity.audience?.length ? `- Audience: ${identity.audience.join('; ')}` : '',
      identity.primaryActions?.length ? `- What visitors should be able to do: ${identity.primaryActions.join('; ')}` : '',
      identity.tone ? `- Tone: ${identity.tone}` : '',
      plan.theme ? `- Visual theme (already applied to the design tokens: use the semantic colour classes bg-bg, bg-surface, text-fg, text-muted, bg-brand, text-on-brand and never hard-code colours): ${plan.theme.mood || 'as described'}; brand ${plan.theme.colors.brand}, background ${plan.theme.colors.bg}, text ${plan.theme.colors.fg}.` : '',
      plan.requirements?.length ? `- Functional needs: ${plan.requirements.join('; ')}` : '',
      `- Menu: ${(plan.navigation || []).map((item) => `${item.label} (${item.route})`).join(', ')}. Main call to action: "${plan.cta?.label}" (${plan.cta?.route}).`
    ].filter(Boolean).join('\n'));
    if (plan.terminology?.length) lines.push(`Vocabulary of this website (the template's word -> use this): ${plan.terminology.map((item) => `${item.from} -> ${item.to}`).join('; ')}`);
    if (plan.avoidTerms?.length) lines.push(`These words, names and records belong to the template's ORIGINAL website and must NOT appear anywhere on this page: ${plan.avoidTerms.join(', ')}.`);
    const entry = page && (plan.pages || []).find((item) => item.route === page.route);
    if (entry) lines.push(`THIS PAGE IN THE PLAN: ${entry.name} (${entry.route}). Purpose: ${entry.purpose}\nSections it needs: ${(entry.sections || []).join('; ') || 'as fits its purpose'}${entry.contentNeeds ? `\nContent it needs: ${entry.contentNeeds}` : ''}${entry.imageNeeds ? `\nPictures it needs: ${entry.imageNeeds}` : ''}`);
    const pictures = mode === 'website' && page ? require('./templateSiteImages').picturesForPage(plan, page.route) : [];
    if (pictures.length) lines.push(`PICTURES MADE FOR THIS PAGE (real files already in the site; use each one once, in a fixed-aspect frame with w-full h-full object-cover and the alt text shown):\n${pictures.map((item) => `- <img src="${item.path}"> (${item.aspect}) alt="${item.alt}" — shows: ${item.subject}`).join('\n')}`);
    if (mode === 'website') lines.push('SECTION MAPPING: for every section of the current page, work out what it is FOR (for example: a gallery of past work, a statement of approach, a call to start a project, testimonials, a journal) and write the equivalent section for this kind of website (for programmes or services, why choose us, the main action of this website, testimonials from its own audience, news). Never swap single words: rewrite each section\'s heading, text, buttons and captions for its new purpose, and drop sections that have no equivalent.');
    if (mode === 'website') lines.push('TEMPLATE FOUNDATION: keep the template\'s layout components, section structure patterns, design tokens, responsive behaviour and routing. Replace everything that says what the website is about: headings, paragraphs, labels, captions, calls to action, sample records and pictures. Remove sections that do not fit this website and add the sections this page needs.');
  }
  if (pages.length) lines.push(`All pages of the website:\n${pages.map((item) => `- ${item.name} (${item.route})${item.description ? `: ${item.description}` : ''}`).join('\n')}`);
  if (written.length) lines.push(`Pages already written for this website (keep the same tone; do not repeat their headlines or copy):\n${written.map((item) => `- ${item.name}: ${item.headings.join(' / ')}`).join('\n')}`);
  lines.push('The USER INSTRUCTION below is about this page only. If it conflicts with the website brief, the instruction wins for this page.');
  return lines.join('\n');
}

// The system-level instruction for turning a template page into a page of another kind of website (website mode only).
const TRANSFORM_PREAMBLE = `You are transforming an existing website template into a website for the user's specified industry. Do not merely replace the website name or a few text strings. Understand the semantic purpose of every existing section and rewrite the content, headings, CTAs, navigation labels and visual assets to match the intended website category. Preserve useful layout and design characteristics, but never retain unrelated industry-specific content. The final page must genuinely represent the requested website.`;

const RULES = `You change ONE page of an existing React + Vite + Tailwind website. The website, its design system and its other pages already exist and must stay exactly as they are.

RULES:
1. Apply the user's instruction to this page only. Keep everything the instruction does not mention: the page's other sections, copy, structure and images stay as they are.
2. You may change ONLY the files listed under "FILES YOU MAY CHANGE", and create NEW files under src/components/ or src/data/. Any other change is discarded.
3. Never touch src/App.jsx, src/data/site.js, package.json, the config files, the shared components, or another page. The route and the navigation already exist.
4. Keep the page's default export and its name. Keep every import valid: import only files that exist or that you create, and only packages already used in the project (react, react-router-dom, lucide-react and the others in the existing imports).
5. Keep the design system: the semantic colours and fonts of the template, the Section / SectionHeading / Container pattern, and a layout that works from 375px to 1440px wide. Do not add inline colours or fixed pixel widths for layout.
6. Images: use only the photos the user uploaded (listed under USER PHOTOS), the verified image URLs given below (if any), or images already on the page, in a fixed-aspect frame with object-cover, with meaningful alt text (a photo the owner wants as a section BACKGROUND instead fills that whole section: absolute inset-0 object-cover behind a readability overlay, see BACKGROUND PHOTOS). Pictures already on the page whose path starts with /assets/images/uploaded- were uploaded by the owner: keep their path and place unless the instruction explicitly says to remove or move them. Never invent image links and never leave an empty image box.
7. Prefer a small exact "patch" (a unique search block copied from the code shown) for small edits; return the complete new file with "modify" when the page is rewritten substantially.
8. If the instruction says what the page or website is FOR or ABOUT (for example "make this page for the school website" or "turn this into a hospital page"), it is a CONTENT REWRITE for that subject, not a small edit. It overrides the website brief and plan for this page. Replace the old subject everywhere on the page (headings, paragraphs, labels, button text, captions, alt texts and the way the sample records are described) with real content for the new subject, so no word of the old subject is left. Keep the layout, components, imports, routes, links and design tokens. Never invent facts (no statistics, fees, dates, names, rankings); use general wording or a clear placeholder instead.`;

/**
 * @param {object} p
 * @param {object} p.template      the resolved template (design tokens, shared files)
 * @param {object} p.page          { name, route, description, componentPath }
 * @param {Array}  p.otherPages    [{ name, route, description }]
 * @param {string} p.instruction
 * @param {Array}  p.ownedFiles    [{ path, content }] files the model may change
 * @param {Array}  p.sharedFiles   [{ path, content }] read-only context
 * @param {string} p.entityBlock   verified named-entity images (optional)
 * @param {object} p.repair        { diagnostics: string[], candidate: [{path, content}] } when a previous attempt was rejected
 */
function buildPageMessages({ template, page, otherPages = [], instruction, ownedFiles, sharedFiles = [], entityBlock = '', attachments = [], repair = null, siteContext = null, siteWide = false }) {
  const mode = siteContext?.mode === 'website' && siteContext?.plan ? 'website' : 'edit';
  const system = `${mode === 'website' ? `${TRANSFORM_PREAMBLE}\n\n` : ''}${siteWide ? SITE_WIDE_RULES : rulesFor(mode)}

DESIGN SYSTEM (${template.name}):
${tokenSummary(template)}`;
  const pictureOnly = require('./templateValidationService').isPictureOnlyEdit(instruction, attachments);
  const limited = !siteWide && mode === 'edit' && !pictureOnly && require('./templateValidationService').keepRatioFor({ instruction, attachments });
  const parts = [
    pictureOnly ? 'PICTURE-ONLY CHANGE: the owner only asked for pictures. Do NOT rewrite, shorten, reorder or remove any heading, paragraph, button, card, list item or section, and do not change any existing wording. Return small exact "patch" edits that add or swap <img> elements (or give an existing empty image box its picture). Every word that is on the page now must still be on it afterwards.' : '',
    limited ? 'TARGETED CHANGE: change ONLY what the instruction mentions. Every other section, heading, paragraph, button, card, list item and image on the page must stay word-for-word as it is now. Return small exact "patch" edits, not a rewritten page. If the instruction names a section or element, touch only that one.' : '',
    siteContext ? websiteBlock({ ...siteContext, page, mode }) : '',
    `PAGE: ${page.name} (route ${page.route}, component ${page.componentPath})${page.description ? `\nPurpose: ${page.description}` : ''}`,
    otherPages.length ? `OTHER PAGES (do not repeat their content; they are not part of this change):\n${otherPages.map((other) => `- ${other.name} (${other.route})${other.description ? `: ${other.description}` : ''}`).join('\n')}` : '',
    `${siteWide ? 'FILES YOU MAY CHANGE (this instruction is about the whole website, so shared components, shared data, src/data/site.js and index.html are included)' : 'FILES YOU MAY CHANGE'}:\n${ownedFiles.map((file) => fence(file.path, file.content)).join('\n\n')}`,
    sharedFiles.length ? `READ-ONLY CONTEXT (shared components you may use; do not change them):\n${sharedFiles.map((file) => fence(file.path, file.content, SHARED_SOURCE_LIMIT)).join('\n\n')}` : '',
    attachments.length ? photoBlock(attachments) : '',
    entityBlock ? `${entityBlock}` : '',
    `USER INSTRUCTION:\n${String(instruction).trim()}`
  ];
  if (repair) {
    parts.push(`YOUR PREVIOUS ANSWER WAS REJECTED. Fix exactly these problems and nothing else:\n${repair.diagnostics.map((item) => `- ${item}`).join('\n')}`);
    if (repair.candidate?.length) parts.push(`YOUR PREVIOUS VERSION OF THE FILES (the starting point for the fix):\n${repair.candidate.map((file) => fence(file.path, file.content)).join('\n\n')}`);
    parts.push('Return the corrected files. The original instruction above still applies in full.');
  }
  return [{ role: 'system', content: system }, { role: 'user', content: parts.filter(Boolean).join('\n\n') }];
}

/** Writing a page for the planned website: the template's wording and pictures are placeholders, not content to keep. */
const WEBSITE_RULE_1 = `1. Write this page for the website described in the WEBSITE BRIEF and the WEBSITE PLAN. The template's existing text, headings, labels, calls to action, sample data and pictures belong to a different kind of website: REPLACE them with content for this website. Keep the layout structure, the Section / SectionHeading / Container pattern, the shared components and the design tokens. Remove sections that do not belong and build the sections this page needs (see THIS PAGE IN THE PLAN). Never invent facts: no statistics, rankings, accreditation, fees, dates, names of people or achievements. Where a detail is not known, write general, truthful wording without numbers or names (for example "a range of programmes" instead of "12 programmes"). NEVER use square-bracket placeholders, lorem ipsum, "insert ... here", "coming soon" filler, or another organisation's name: every section must be complete, meaningful content, and every page uses the one website name given in the plan.`;
const WEBSITE_RULE_6 = `6. Images: do not keep the template's own pictures (/images/hero.svg, /images/card-1.svg, /images/card-2.svg, /images/card-3.svg): they show a different kind of website. Use the photos the user uploaded (listed under USER PHOTOS) where given, then the pictures made for this page (listed under PICTURES MADE FOR THIS PAGE); only when neither exists use the neutral photo slots /images/slot-hero.svg, /images/slot-1.svg, /images/slot-2.svg or /images/slot-3.svg in a COMPACT fixed-aspect frame with object-cover and a descriptive alt text: the hero slot at most aspect-[21/9] with max-h-72, card and section slots at most aspect-[4/3] with max-h-44, never a tall or full-screen block, because an empty slot should take little room. Never invent image links, and never draw fake logos, certificates, seals or badges.`;

function rulesFor(mode) {
  if (mode !== 'website') return RULES;
  return RULES.replace(/^1\. .*$/m, WEBSITE_RULE_1).replace(/^6\. .*$/m, WEBSITE_RULE_6);
}

/** The instruction is about the whole website: shared parts may change, so the brand and content are consistent everywhere. */
const SITE_WIDE_RULES = `You change an existing React + Vite + Tailwind website. The user's instruction is about the WHOLE website (or about a shared part such as the menu, footer, logo or a shared component), so it must be applied in every place it appears.

RULES:
1. Carry out the instruction fully and literally. If it says to remove something (for example rentals, a section, a tab, a brand name), remove it from every file you may change: page text, shared components, menus, footer, data files, site name, tagline, contact details, page title and descriptions, and the logic that supported it (tabs, filters, links). Leave no word of the removed subject behind, and no link that points to something that no longer exists.
2. If it gives a new subject or brand, rewrite the old subject everywhere (logo text, site data in src/data/site.js, navigation labels, footer, calls to action, index.html title and description) with content for the new subject. Menu links must lead to real routes or to existing on-page sections (use ids and /#id links).
3. You may change ONLY the files listed under "FILES YOU MAY CHANGE", and create NEW files under src/components/ or src/data/. Do not touch src/App.jsx, src/main.jsx, src/index.css, package.json, the config files or the other pages' component files. Keep every route working.
4. Keep every default export and name. Keep every import valid: import only files that exist or that you create, and only packages already used in the project. Remove imports you no longer use.
5. Keep the design system (semantic colours, fonts, Section / SectionHeading / Container) and a layout that works from 375px to 1440px.
6. Images: use only the photos the user uploaded, verified image URLs given below, or images already in the project. Never invent image links.
7. Prefer small exact "patch" edits (a unique search block copied from the code shown); return a complete file with "modify" when you rewrite it substantially.
8. Never invent facts: no statistics, rankings, fees, dates, phone numbers, emails, names of people. Use general wording or a clear placeholder instead.`;

module.exports = { buildPageMessages, RULES, rulesFor, SITE_WIDE_RULES };
