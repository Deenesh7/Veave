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
/**
 * A video the owner uploaded plays BEHIND a section (or the page). The element and its attributes are given exactly: a browser only
 * autoplays a video that is muted and inline, and a video put in an <img> or as a CSS background does not play at all.
 */
const VIDEO_RULES = (videos) => `USER VIDEOS (the owner uploaded ${videos.length === 1 ? 'this video' : 'these videos'}; ${videos.length === 1 ? 'it is' : 'they are'} already in the site): ${videos.map((video) => `"${video.path}"`).join(', ')}.
A video is used as a BACKGROUND (that is what the owner wants unless the instruction names another use). Never put a video in an <img>, never use it as a CSS background-image, never change its path. The section that gets it becomes <section> or the Section wrapper with className "relative isolate overflow-hidden" and a min height that suits its content (for example min-h-[70vh] for a hero). Its FIRST child is exactly (the element of the video that section gets):
${videos.map((video) => `<video src="${video.path}" autoPlay muted loop playsInline preload="auto" disablePictureInPicture aria-hidden="true" tabIndex={-1} className="absolute inset-0 -z-10 h-full w-full object-cover motion-reduce:hidden" />`).join('\n')}
followed by a readability overlay <div className="absolute inset-0 -z-10 bg-black/45" aria-hidden="true" /> (or a gradient), and the section's existing text and buttons stay in a normal Container above it with light text colours that stay readable. muted, playsInline and autoPlay are required (without them browsers refuse to start it), loop keeps it running, motion-reduce:hidden leaves visitors who ask for less motion with the overlay and the section's background colour. For a whole-page video background use the same element with "fixed" instead of "absolute" and wrap the page content in a root <div className="relative isolate min-h-screen">. Use each video once, in the section the OWNER WANTS IT AS / the instruction names; if none is named, the first (hero) section. Do not add controls, a sound or a play button.`;

function photoBlock(attachments) {
  const lines = attachments.map((photo) => {
    const details = [
      photo.width && photo.height ? `${photo.width}x${photo.height}px, ${photo.width >= photo.height ? 'landscape' : 'portrait'}` : '',
      photo.caption ? `shows: ${photo.caption}` : '',
      photo.tags?.length ? `subjects: ${photo.tags.join(', ')}` : '',
      photo.placement ? `OWNER WANTS IT AS: ${String(photo.placement).startsWith('section:') ? `placed in the "${String(photo.placement).slice(8)}" section of this page (only in that section; if the owner note says "background", use it as that section's background)` : (PLACEMENT_LABEL[photo.placement] || photo.placement)}` : '',
      photo.note ? `owner note: "${photo.note}"` : ''
    ].filter(Boolean).join('; ');
    if (photo.kind === 'video') return `- <video src="${photo.path}" ...>  (VIDEO file "${photo.name}"${photo.durationSeconds ? `, ${photo.durationSeconds}s` : ''}${details ? `; ${details}` : ''})`;
    return `- <img src="${photo.path}" ...>  (file "${photo.name}"${details ? `; ${details}` : ''})`;
  }).join('\n');
  const videos = attachments.filter((photo) => photo.kind === 'video');
  return `${videos.length ? `${VIDEO_RULES(videos)}\n\n` : ''}USER PHOTOS (the user uploaded these pictures for this change; they are already in the site):\n${lines}\nPlace every photo where its OWNER WANTS IT AS / owner note / the instruction says. If none says, put each photo in the section whose subject matches what it shows. Use each photo exactly once with its exact path and a meaningful alt text (use the description above). An ordinary photo goes in a fixed-aspect frame (aspect-[4/3], aspect-square or aspect-video) with w-full h-full object-cover, and loading="lazy" below the fold.
WHOLE-PAGE BACKGROUND: when a photo is wanted as the background of the whole page (OWNER WANTS IT AS the background of the WHOLE page, or the instruction says so), wrap the page's content in a root <div className="relative isolate min-h-screen"> whose first child is <img src="EXACT_PATH" alt="" aria-hidden="true" className="fixed inset-0 -z-10 h-full w-full object-cover" /> followed by a readability overlay <div className="fixed inset-0 -z-10 bg-black/40" aria-hidden="true" />. Then make this page's own sections see-through so the picture shows: remove their solid background colours or use a translucent one (for example bg-bg/70 with backdrop-blur-sm on cards and panels) and switch their text to colours that stay readable on the photo. This background belongs to THIS page only: put it only in this page's own file, never in a shared component, the layout, the navigation, the footer, src/index.css, the body/html element or any other page, so every other page of the website keeps its own look. The picture must cover the page at every screen width, never repeat and never stretch.
BACKGROUND PHOTOS: when a photo is wanted as a background (OWNER WANTS IT AS a section background image, or the owner note or the instruction says "background"), do NOT put it in a framed card. Make that section's wrapper "relative isolate overflow-hidden" with a min height that suits its content (for example min-h-[60vh] for a hero), put the photo as the first child <img src="EXACT_PATH" alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover" />, add a dark/brand overlay sibling <div className="absolute inset-0 -z-10 bg-black/45" aria-hidden="true" /> (or a gradient) so the text stays readable, and keep the section's content in a normal Container above it with light text colours that stay readable on the photo. The picture must fill the whole section on every screen width, never repeat, never stretch, and the section's existing text and buttons must remain. Never change a path, never swap a photo for another picture, and never leave out a photo that is listed here. A video listed under USER VIDEOS is never placed with <img>.`;
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
5. Keep the design system: the semantic colours and fonts of the template, the Section / SectionHeading / Container pattern, and a layout that works from 375px to 1440px wide. Do not add inline colours or fixed pixel widths for layout, EXCEPT when the owner names an exact colour, size or font ("make it black", "red button", "font size 24"): then use exactly what was named (for a colour a class such as bg-black or an arbitrary value such as bg-[#000000]) and never substitute the nearest design token or a similar colour. If the named value is not what you applied, the work is not done.
6. Images: use only the photos the user uploaded (listed under USER PHOTOS), the verified image URLs given below (if any), or images already on the page, in a fixed-aspect frame with object-cover, with meaningful alt text (a photo the owner wants as a section BACKGROUND instead fills that whole section: absolute inset-0 object-cover behind a readability overlay, see BACKGROUND PHOTOS). Pictures already on the page whose path starts with /assets/images/uploaded- were uploaded by the owner: keep their path and place unless the instruction explicitly says to remove or move them. Never invent image links and never leave an empty image box.
7. Prefer a small exact "patch" (a unique search block copied from the code shown) for small edits; return the complete new file with "modify" when the page is rewritten substantially.
8. If the instruction says what the page or website is FOR or ABOUT (for example "make this page for the school website" or "turn this into a hospital page"), it is a CONTENT REWRITE for that subject, not a small edit. It overrides the website brief and plan for this page. Replace the old subject everywhere on the page (headings, paragraphs, labels, button text, captions, alt texts and the way the sample records are described) with real content for the new subject, so no word of the old subject is left. Keep the layout, components, imports, routes, links and design tokens. Never invent facts (no statistics, fees, dates, names, rankings); use general wording or a clear placeholder instead.
9. AI ANSWERS: when the owner asks for the website to answer visitors with AI (an assistant box, a popup that explains or generates content, "ask AI"), call window.VEAVE_AI.ask(question, { topic }). The helper already exists on every page; it returns a Promise of a plain-text answer written from this website's own content. Never call any other AI API, never put keys or URLs in the code, and never invent a server. Show the popup at once with a clear loading line, then the answer (render it as plain text); if the call fails or window.VEAVE_AI is missing, show a clear error line such as "The assistant could not answer right now. Please try again." with a retry; never replace the answer with a predefined text and never keep a list of canned answers. A popup is a real dialog: role="dialog", a close button, Escape closes it, and it never blocks the rest of the page.
10. FUNCTIONAL REQUIREMENT: build working behaviour, not a picture of it. Read the whole instruction first and list every feature, interaction and behaviour it asks for; each one must work. Buttons do their action, tabs switch real content, forms accept and process the input, search searches the real content, dropdowns change what is shown, popups open and close (Escape and a close button), navigation opens the right page or section. Never add a control that only looks functional. Do the thing at the moment the owner described: if they say a popup opens when a button is clicked, it opens on that click, not after another click. Never remove or replace an existing working integration (such as the website assistant) with fixed text unless the owner explicitly asks for fixed text. Never add unused arrays, variables, functions or response objects to look complete, never invent a success message, never simulate an API reply, and never mention window.VEAVE_AI unless the code really asks it the visitor's own question and shows the answer. Use the project's existing integration through its real interface. A control that is pressed with missing input must answer with visible feedback (a clear message), never silently return. Think through the journey: what the visitor sees on opening, on clicking each control, on typing, on submitting, and what happens when it fails, then implement the loading, success, empty and error states. Change only the files and components the request needs and keep existing routes, styling, state and features. Before you answer, check every requirement of the instruction against your code: the component exists, the handler is connected, it does the requested action, the interface shows the result. If something cannot be built because an integration or setting is missing, do not fake it: say so in the visible interface text only if the owner asked for it, and keep the rest working.`;

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
function buildPageMessages({ template, page, otherPages = [], instruction, ownedFiles, sharedFiles = [], entityBlock = '', attachments = [], repair = null, siteContext = null, siteWide = false, intent = null, policy = null, researchBlock = '' }) {
  const mode = siteContext?.mode === 'website' && siteContext?.plan ? 'website' : 'edit';
  const system = `${mode === 'website' ? `${TRANSFORM_PREAMBLE}\n\n` : ''}${siteWide ? SITE_WIDE_RULES : rulesFor(mode)}

DESIGN SYSTEM (${template.name}):
${tokenSummary(template)}`;
  const pictureOnly = require('./templateValidationService').isPictureOnlyEdit(instruction, attachments, policy);
  const limited = !siteWide && mode === 'edit' && !pictureOnly && !policy?.wholeFile && require('./templateValidationService').keepRatioFor({ instruction, attachments, policy });
  const aiAnswers = require('./templateValidationService').wantsAiAnswers(instruction);
  // The owner picked a section and sees its texts in the browser. Say which of the files above really contain them, so the change is made where the code is.
  const phrases = [...new Set((String(instruction).match(/"([^"\n]{8,140})"/g) || []).map((item) => item.slice(1, -1).trim()))].slice(0, 30);
  const where = phrases.length >= 2 ? [...ownedFiles, ...sharedFiles].map((file) => {
    const found = phrases.filter((phrase) => typeof file.content === 'string' && file.content.includes(phrase)).length;
    return found ? { path: file.path, found, editable: ownedFiles.some((item) => item.path === file.path) } : null;
  }).filter(Boolean).sort((x, y) => y.found - x.found).slice(0, 4).map((item) => `- ${item.path}: ${item.found} of ${phrases.length} texts${item.editable ? '' : ' (read-only: only use it)'}`).join('\n') : '';
  const parts = [
    aiAnswers ? 'AI ANSWER REQUIRED: the owner wants the website itself to show AI-generated content (for example a pop-up box that an AI fills in). The website already has a working assistant: window.VEAVE_AI.ask(question, { topic }) returns a Promise of a plain-text answer written from this website\'s own content. You MUST use it: at the moment the owner described (by default when the visitor clicks the button the owner named; but if the owner says the visitor first picks a tab or a topic and/or types a question and only then presses a submit button such as Explore, then picking a tab, picking a topic or typing must NOT start the AI and must NOT open the box: only that submit button does), open the pop-up box immediately (role="dialog", a loading line such as "Writing an answer for you…", a close button, Escape closes it), call window.VEAVE_AI.ask with a clear question (for example "Give a short, welcoming overview of the campus"), and show the answer in the box as plain text when it arrives. If the Promise fails or window.VEAVE_AI is missing, show a clear error line in the box (for example "The assistant could not answer right now. Please try again.") with a retry, never an invented answer. Do NOT write the generated content into the page as fixed text, and never call any other AI API or use any key.' : '',
    pictureOnly ? 'PICTURE-ONLY CHANGE: the owner only asked for pictures. Do NOT rewrite, shorten, reorder or remove any heading, paragraph, button, card, list item or section, and do not change any existing wording. Return small exact "patch" edits that add or swap <img> elements (or give an existing empty image box its picture). Every word that is on the page now must still be on it afterwards.' : '',
    limited ? 'TARGETED CHANGE: change ONLY what the instruction mentions. Every other section, heading, paragraph, button, card, list item and image on the page must stay word-for-word as it is now. Return small exact "patch" edits, not a rewritten page. If the instruction names a section or element, touch only that one.' : '',
    require('./templateValidationService').wantsRemoval(instruction, policy) ? 'REMOVAL: the owner wants something taken away. Delete it completely: the whole element (for a section, its entire <Section>...</Section> block, not only its words), the data, state and handlers that only it used, the imports nothing uses any more, and every link, menu item or button that pointed to it. Do not leave an empty box, a blank gap, a placeholder, or a link to something that is gone. Do not replace it with other content unless asked, and do not touch the sections that were not named.' : '',
    siteContext ? websiteBlock({ ...siteContext, page, mode }) : '',
    `PAGE: ${page.name} (route ${page.route}, component ${page.componentPath})${page.description ? `\nPurpose: ${page.description}` : ''}`,
    otherPages.length ? `OTHER PAGES (do not repeat their content; they are not part of this change):\n${otherPages.map((other) => `- ${other.name} (${other.route})${other.description ? `: ${other.description}` : ''}`).join('\n')}` : '',
    `${siteWide ? 'FILES YOU MAY CHANGE (this instruction is about the whole website, so shared components, shared data, src/data/site.js and index.html are included)' : 'FILES YOU MAY CHANGE'}:\n${ownedFiles.map((file) => fence(file.path, file.content)).join('\n\n')}`,
    sharedFiles.length ? `READ-ONLY CONTEXT (shared components you may use; do not change them):\n${sharedFiles.map((file) => fence(file.path, file.content, SHARED_SOURCE_LIMIT)).join('\n\n')}` : '',
    attachments.length ? photoBlock(attachments) : '',
    entityBlock ? `${entityBlock}` : '',
    researchBlock || '',
    where ? `WHERE THE TEXT THE OWNER IS LOOKING AT IS WRITTEN IN THE CODE (the section content quoted in the instruction was found in these files; the code that produces what the owner sees, and so the code to change, is there):\n${where}` : '',
    policy ? require('../ai/intentUnderstandingService').planBlock(intent, policy) : '',
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
5. Keep the design system (semantic colours, fonts, Section / SectionHeading / Container) and a layout that works from 375px to 1440px, except that an exact colour, size or font the owner named is applied exactly as named, never replaced by the nearest design token.
6. Images: use only the photos the user uploaded, verified image URLs given below, or images already in the project. Never invent image links.
7. Prefer small exact "patch" edits (a unique search block copied from the code shown); return a complete file with "modify" when you rewrite it substantially.
8. Never invent facts: no statistics, rankings, fees, dates, phone numbers, emails, names of people. Use general wording or a clear placeholder instead.`;

module.exports = { buildPageMessages, RULES, rulesFor, SITE_WIDE_RULES };
