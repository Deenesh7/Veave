'use strict';

// Prompts for the prototype engine. Every prompt carries measured facts about the reference, never "make it look nice".

const TOKEN_CLASSES = `Colour ONLY through the theme tokens: bg-bg, bg-surface, bg-surface-2, border-line, text-fg, text-muted, bg-brand-600 with text-on-brand, text-accent. Layout width: max-w-container mx-auto px-6. Radius: rounded-token-sm / rounded-token / rounded-token-lg / rounded-token-pill. Fonts come from the theme (font-heading, font-sans); never set another font-family. Do not use fixed palette classes (zinc-*, gray-*, black, white) or hex colours.`;

const OWN_CONTENT = `CONTENT: write original, specific copy for THE USER'S business described in the request. Do NOT copy the reference website's brand name, headings, text, logos or images. The reference only decides structure, layout, spacing and visual style.`;

const STACK = `Stack: React 18 function components, JSX (no TypeScript), Tailwind CSS utility classes, react-router-dom (Link/NavLink), lucide-react icons, framer-motion for component motion. Local imports only for files that exist. No placeholder text like "Lorem ipsum".`;

function describeDesign(ds) {
  const t = ds.typography; const c = ds.colors;
  const type = (r) => t[r] ? `${r}: ${t[r].family} ${t[r].weight}, ${t[r].size}px (mobile ${t[r].sizeMobile}px), line-height ${t[r].lineHeight}, letter-spacing ${t[r].letterSpacing}px${t[r].textTransform && t[r].textTransform !== 'none' ? `, ${t[r].textTransform}` : ''}` : null;
  return [
    `Fonts: headings "${ds.fonts.heading?.google || ds.fonts.heading?.original}", body "${ds.fonts.body?.google || ds.fonts.body?.original}" (already loaded by the theme).`,
    `Type scale: ${['h1', 'h2', 'h3', 'p', 'button', 'nav'].map(type).filter(Boolean).join(' | ')}`,
    `Colours (already in the theme variables): background ${c.background}, surface ${c.surface}, text ${c.foreground}, muted ${c.muted}, primary ${c.primary} (on-primary ${c.onPrimary}), accent ${c.accent}, line ${c.line}. ${c.dark ? 'This is a DARK design.' : 'This is a LIGHT design.'}`,
    `Layout: content width ${ds.layout.containerWidth}px, section vertical padding ${ds.layout.sectionPaddingY.join('/') || 'n/a'}px, gaps ${ds.layout.gaps.join('/') || 'n/a'}px, grid columns seen ${ds.layout.gridColumns.join('/') || 'n/a'}, breakpoints ${ds.layout.breakpoints.join('/') || 'n/a'}.`,
    `Shape: radii ${ds.radius.all.join(', ') || 'n/a'}; shadows ${ds.shadows.slice(0, 2).join(' ; ') || 'none'}; gradients ${ds.gradients.slice(0, 2).join(' ; ') || 'none'}.`,
    ds.buttons ? `Buttons: background ${ds.buttons.background}, text ${ds.buttons.color}, radius ${ds.buttons.radius}, padding ${ds.buttons.padding}, ${ds.buttons.fontSize} / ${ds.buttons.fontWeight}.` : null,
    ds.cards ? `Cards: background ${ds.cards.background}, border ${ds.cards.border}, radius ${ds.cards.radius}, shadow ${ds.cards.shadow || 'none'}, padding ${ds.cards.padding}.` : null
  ].filter(Boolean).join('\n');
}

function sharedPrompt({ request, siteName, ds, inventory, header, footer, files }) {
  const system = `You build the SHARED COMPONENTS of a website prototype. ${STACK}\n${TOKEN_CLASSES}\n${OWN_CONTENT}\nReturn ONLY file operations (create) for exactly the files requested. Do not create pages and do not edit App.jsx.`;
  const nav = inventory.navigation;
  const user = `USER REQUEST (the business this website is for):\n${request}\n\nSITE NAME: ${siteName}\n\nFILES TO CREATE:\n- src/components/Navbar.jsx (default export Navbar)\n- src/components/Footer.jsx (default export Footer)${inventory.shared.filter((s) => s.kind === 'block').map((s) => `\n- ${s.file} (default export ${s.componentName}) a repeated block "${s.heading}" used on: ${s.pages.join(', ')}`).join('')}\n\nDATA: import { site } from '../data/site'; it exports name, nav (items { label, route, children[] }), footerLinks and routes. Render EVERY nav item and child as a router Link/NavLink to its route (active styling on the current route). Dropdown children appear in a hover/focus menu on desktop and inline in the mobile menu.\n\nREFERENCE HEADER (measured): height ${header?.outline?.height}px, background ${header?.outline?.background}, ${header?.outline?.items} links, logo ${inventory.assets?.logoSlot ? 'slot ' + inventory.assets.logoSlot : 'text wordmark'}.\nREFERENCE FOOTER (measured): height ${footer?.outline?.height}px, background ${footer?.outline?.background}, columns ${footer?.outline?.columns}, about ${footer?.outline?.words} words of text.\nNAVIGATION: ${nav.primary.map((p) => `${p.label} -> ${p.route}${p.children.length ? ` [${p.children.map((c) => `${c.label} -> ${c.route}`).join(', ')}]` : ''}`).join('; ')}\n\nDESIGN SYSTEM:\n${describeDesign(ds)}\n\nThe navbar is sticky, uses the reference's height and background, and has a working mobile menu (framer-motion AnimatePresence, a short fade/slide, keyed children). The footer has the reference's column structure with the footer links.${inventory.assets?.logoSlot ? `\nLOGO: render <img data-asset-slot="${inventory.assets.logoSlot.slotId}" src="${inventory.assets.logoSlot.publicPath}" alt="${siteName}" width="${inventory.assets.logoSlot.width}" height="${inventory.assets.logoSlot.height}"> in the navbar.` : ''}\n\nEXISTING FILES (context, do not rewrite): ${files.map((f) => f.path).slice(0, 60).join(', ')}`;
  return { system, user };
}

function slotsText(slots, mapping) {
  if (!slots.length) return 'No images on this page in the reference.';
  return slots.map((s) => `- slot ${s.slotId}: ${s.role}, ${s.width}x${s.height}px on desktop${s.mobileWidth ? ` (${s.mobileWidth}x${s.mobileHeight} on mobile)` : ''}, in section #${s.sectionIndex} (${s.sectionKind || 'content'}${s.sectionHeading ? ` "${s.sectionHeading}"` : ''}); use src="${mapping.get(s.slotId)?.publicPath}" object-fit ${s.objectFit || 'cover'}${s.borderRadius && s.borderRadius !== '0px' ? `, corner radius ${s.borderRadius}` : ''}`).join('\n');
}

function outlineText(sections, mobile) {
  const mobileBy = new Map((mobile || []).map((m) => [m.index, m]));
  return sections.map((s) => `#${s.index} ${s.kind.toUpperCase()}${s.heading ? ` heading "${s.heading}" (h${s.headingLevel || 2})` : ''}: layout ${s.layout}${typeof s.layout === 'number' ? ' columns' : ''}${mobileBy.get(s.index) ? ` (mobile: ${mobileBy.get(s.index).layout})` : ''}, ${s.items} item(s), ${s.images} image(s), ${s.buttons} button(s), ~${s.words} words, background ${s.background}, padding ${s.paddingY}, height ${s.height}px${s.fullBleed ? ', full-bleed' : ''}, text-align ${s.align}`).join('\n');
}

function pagePrompt({ request, siteName, ds, page, slots, mapping, inventory, existingPaths, referenceImage }) {
  const sectionsToBuild = page.sections.filter((s) => !['header', 'footer'].includes(s.kind));
  const system = `You build ONE PAGE of a multi-page website prototype, matching the measured reference. ${STACK}\n${TOKEN_CLASSES}\n${OWN_CONTENT}\n\nOUTPUT: file operations that create ${page.file} (default export ${page.componentName}). You may add small page-specific components named src/components/${page.componentName}*.jsx. Do NOT modify any other file: App.jsx, Navbar, Footer, the theme, the data file and other pages are managed elsewhere.\n\nSTRUCTURE RULES: the page returns a fragment (<>...</>) whose direct children are the page's <section> elements, in the order of the reference outline; the navbar and footer are rendered by App, so do not add them. Exactly one <h1>. Call useSeo({ title, description }) (import useSeo from '../hooks/useSeo') and useGsapReveal() (import useGsapReveal from '../hooks/useGsapReveal') at the top. Mark hero content with data-hero, section blocks with data-reveal, and card/feature grids with data-stagger. Every image must be a slot image exactly as listed: <img data-asset-slot="ID" src="PATH" alt="..." width="W" height="H" className="..."> with a fixed aspect frame. Never use remote image URLs or invent other images.`;
  const user = `FILE TO CREATE: ${page.file} (default export ${page.componentName})\n\nUSER REQUEST (the business):\n${request}\n\nSITE NAME: ${siteName}\nPAGE: ${page.route} (${page.type}) "${page.title}"${page.description ? `\nPAGE DESCRIPTION IN THE REFERENCE: ${page.description}` : ''}\n\nBUILD EVERY SECTION BELOW, IN ORDER (${sectionsToBuild.length} sections; the page must have at least ${Math.max(1, Math.ceil(sectionsToBuild.length * 0.8))}):\n${outlineText(sectionsToBuild, page.mobileSections)}\n\nREFERENCE HEADINGS: ${page.headings.map((h) => `h${h.level} "${h.text}"`).join(' | ') || 'none'} (write your own headings for the user's business with the same hierarchy and similar length).\n\nASSET SLOTS FOR THIS PAGE:\n${slotsText(slots, mapping)}\n\nDESIGN SYSTEM (already applied through the theme; follow its measurements):\n${describeDesign(ds)}\n\nRESPONSIVE: below 768px the layout follows the "mobile" layout noted per section (usually one column); no horizontal scrolling at 390px.\n\nOTHER PAGES (link to them with react-router-dom Link): ${inventory.pages.map((p) => `${p.route}`).join(', ')}\nEXISTING FILES: ${existingPaths.slice(0, 80).join(', ')}${referenceImage ? '\n\nA full-page screenshot of the reference page is attached for visual guidance only (layout, rhythm, proportions). Do not copy its text, brand or pictures.' : ''}`;
  return { system, user };
}

function repairPrompt({ request, page, result, instructions, code, slots, mapping }) {
  const system = `You fix ONE page of a website prototype. Return file operations that modify ONLY ${page.file} (or src/components/${page.componentName}*.jsx). Make the smallest change that resolves each numbered issue; keep everything that already works. ${TOKEN_CLASSES}`;
  const user = `FILE TO MODIFY: ${page.file}\n\nThe page ${page.route} was rendered in a browser at desktop and mobile size and compared with the reference. These problems were MEASURED:\n${instructions}\n\nASSET SLOTS (keep exactly these ids and paths):\n${slotsText(slots, mapping)}\n\nREFERENCE OUTLINE OF THIS PAGE (the structure the page must keep or regain):\n${outlineText(page.sections.filter((x) => !['header', 'footer'].includes(x.kind)), page.mobileSections)}\n\nCURRENT PAGE CODE (${page.file}):\n${code}\n\nUSER REQUEST (business context): ${request}`;
  return { system, user };
}

module.exports = { sharedPrompt, pagePrompt, repairPrompt, describeDesign, outlineText, slotsText, TOKEN_CLASSES, OWN_CONTENT };
