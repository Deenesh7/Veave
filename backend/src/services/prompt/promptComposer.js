/**
 * VEAVE Prompt Composer
 *
 * Deterministic renderer: takes the validated UISpec and produces the
 * final implementation-ready markdown prompt. No LLM calls here — this
 * IS the "prompt compiler" output.
 */

function compose(spec) {
  const lines = [];

  push(lines, `# PROJECT`);
  push(lines, spec.project || 'Untitled VEAVE Project');
  br(lines);

  push(lines, `# OBJECTIVE`);
  push(lines, spec.objective || 'Build a modern, production-quality UI that satisfies the user description.');
  br(lines);

  push(lines, `# TARGET USERS`);
  bulletList(lines, spec.targetUsers, ['end user']);
  br(lines);

  push(lines, `# TECHNOLOGY`);
  const t = spec.technology || {};
  bulletList(lines, [
    `Framework: ${t.framework || 'react'}`,
    `Language: ${t.language || 'javascript'}`,
    `Styling: ${t.styling || 'tailwindcss'}`,
    `Bundler: ${t.bundler || 'vite'}`,
    `Icons: ${t.icons || 'lucide-react'}`,
    ...(t.extras?.length ? [`Extras: ${t.extras.join(', ')}`] : [])
  ]);
  br(lines);

  push(lines, `# APPLICATION STRUCTURE`);
  push(lines, `Product type: ${spec.productType || 'application'}`);
  if (spec.navigation) push(lines, `Navigation: ${spec.navigation}`);
  if (spec.authentication) push(lines, `Authentication: ${spec.authentication}`);
  br(lines);

  push(lines, `# ROUTES`);
  bulletList(lines, uniq((spec.routes && spec.routes.length ? spec.routes : (spec.pages || []).map(p => p.route))
    .filter(Boolean)), ['/ — Home']);
  br(lines);

  push(lines, `# PAGE DESIGN`);
  if (!spec.pages?.length) {
    push(lines, '_No pages specified — the LLM must derive a minimal set of pages from the objective._');
  } else {
    spec.pages.forEach((p, i) => {
      push(lines, `## ${i + 1}. ${p.name}${p.route ? `  (\`${p.route}\`)` : ''}`);
      if (p.purpose) push(lines, `Purpose: ${p.purpose}`);
      if (p.layout)  push(lines, `Layout: ${p.layout}`);
      if (p.sections?.length)     bulletList(lines, p.sections.map(s => `Section: ${s}`));
      if (p.components?.length)   bulletList(lines, p.components.map(c => `Uses: ${c}`));
      if (p.interactions?.length) bulletList(lines, p.interactions.map(x => `Interaction: ${x}`));
      br(lines);
    });
  }

  push(lines, `# COMPONENTS`);
  if (!spec.components?.length) {
    push(lines, '_The LLM must derive the necessary components from the page design._');
  } else {
    spec.components.forEach(c => {
      const meta = [];
      if (c.props?.length)    meta.push(`props: ${c.props.join(', ')}`);
      if (c.variants?.length) meta.push(`variants: ${c.variants.join(', ')}`);
      if (c.states?.length)   meta.push(`states: ${c.states.join(', ')}`);
      push(lines, `- **${c.name}** — ${c.description || 'Reusable UI component.'}${meta.length ? ` _(${meta.join(' · ')})_` : ''}`);
    });
  }
  br(lines);

  push(lines, `# FUNCTIONALITY`);
  bulletList(lines, spec.features, ['Render the described pages with real, plausible content.']);
  br(lines);

  push(lines, `# USER INTERACTIONS`);
  bulletList(lines, spec.interactions, [
    'Hover, focus, and pressed states are visually distinct',
    'Forms validate inline with clear error messages'
  ]);
  br(lines);

  push(lines, `# STATES`);
  bulletList(lines, spec.states, ['loading', 'empty', 'error', 'success']);
  br(lines);

  push(lines, `# DATA REQUIREMENTS`);
  if (!spec.dataRequirements?.length) {
    push(lines, 'Use local component state with realistic seed data. No backend required unless requested.');
  } else {
    spec.dataRequirements.forEach(d => {
      push(lines, `- **${d.entity}**` +
        (d.fields?.length        ? ` — fields: ${d.fields.join(', ')}`               : '') +
        (d.relationships?.length ? ` — relationships: ${d.relationships.join(', ')}` : ''));
    });
  }
  br(lines);

  if (spec.forms?.length) {
    push(lines, `# FORMS`);
    spec.forms.forEach(f => {
      push(lines, `- **${f.name || 'Form'}** — fields: ${f.fields.join(', ') || '—'}` +
        (f.validation?.length ? ` · validation: ${f.validation.join(', ')}` : '') +
        (f.submitAction       ? ` · submit: ${f.submitAction}`              : ''));
    });
    br(lines);
  }

  push(lines, `# VISUAL DESIGN SYSTEM`);
  const ds = spec.designSystem || {};
  bulletList(lines, [
    `Name: ${ds.name || 'veave'}`,
    ds.mood?.length ? `Mood: ${ds.mood.join(', ')}` : null,
    `Radius: ${ds.radius || '12–16px cards, 10px buttons/inputs'}`,
    `Spacing scale: ${ds.spacing || '4 / 8 / 12 / 16 / 24 / 32 / 48'}`,
    `Shadows: ${ds.shadows || 'thin borders + subtle single-layer shadows'}`,
    `Icons: ${ds.icons || 'lucide-react'}`
  ].filter(Boolean));
  br(lines);

  push(lines, `# IMAGE, TEXT AND CARD CONSISTENCY`);
  bulletList(lines, [
    'Strict Rule: All cards in the same repeated component group (features, products, blogs, courses, listings) MUST follow the exact same layout structure.',
    'Allowed Patterns: Pattern A (Image Above Text), Pattern B (Background Image with Overlay), Pattern C (Image + Text Side-by-Side). Never mix patterns within the same group.',
    'Aspect Ratios: Use a consistent aspect ratio (16:9 landscape, 4:3 standard, 1:1 square, or 4:5 portrait) with object-cover and equal image container heights.',
    'Card Heights: Keep card heights visually aligned using flexible containers (flex flex-col justify-between).',
    'Text Hierarchy: Strictly follow Category -> Title -> Description -> Metadata across all cards.',
    'No Random Text Over Images: Never mix floating title over image with a separate title below. Exactly ONE clear title per card.',
    'No Text Overflow: Prevent text spilling outside containers with line-clamp, word-break, and overflow-wrap.',
    'Overlay Rule: All overlays/badges must stay strictly inside the relative image container using absolute positioning.',
    'Accessibility: Provide descriptive alt text for every meaningful image (never "image", "picture", or "photo").'
  ]);
  br(lines);

  push(lines, `# TYPOGRAPHY`);
  const ty = ds.typography || {};
  bulletList(lines, [
    `Primary: ${ty.primary || 'Inter'}`,
    `Secondary: ${ty.secondary || 'Geist'}`,
    `Display: ${ty.display || 'Space Grotesk'}`,
    ...(ty.scale || [])
  ]);
  br(lines);

  push(lines, `# COLOR SYSTEM`);
  const c = ds.colors || {};
  bulletList(lines, [
    `background: ${c.background || '#FFFFFF'}`,
    `surface: ${c.surface || '#FAFAFA'}`,
    `border: ${c.border || '#E5E7EB'}`,
    `text: ${c.text || '#111827'}`,
    `muted: ${c.muted || '#6B7280'}`,
    `accent: ${c.accent || '#3B82F6'}`,
    `accent soft: ${c.accentSoft || '#DBEAFE'}`,
    ...(c.palette || [])
  ]);
  br(lines);

  push(lines, `# RESPONSIVE DESIGN`);
  const r = spec.responsive || {};
  bulletList(lines, [
    `Breakpoints: ${(r.breakpoints || ['sm','md','lg','xl']).join(', ')}`,
    r.mobile  ? `Mobile: ${r.mobile}`   : 'Mobile: single column, stacked navigation, larger tap targets',
    r.tablet  ? `Tablet: ${r.tablet}`   : 'Tablet: two-column where meaningful, condensed navigation',
    r.desktop ? `Desktop: ${r.desktop}` : 'Desktop: multi-column layouts, persistent navigation, max-width containers'
  ]);
  br(lines);

  push(lines, `# ACCESSIBILITY`);
  const a = spec.accessibility || {};
  bulletList(lines, [
    `WCAG AA contrast: ${a.contrastAA !== false ? 'yes' : 'no'}`,
    `Semantic HTML: ${a.semanticHtml !== false ? 'yes' : 'no'}`,
    `ARIA labels on interactive elements: ${a.ariaLabels !== false ? 'yes' : 'no'}`,
    `Full keyboard navigation: ${a.keyboardNav !== false ? 'yes' : 'no'}`,
    `Visible focus rings: ${a.focusVisible !== false ? 'yes' : 'no'}`,
    ...(a.notes || [])
  ]);
  br(lines);

  push(lines, `# ANIMATIONS`);
  bulletList(lines, spec.animations, [
    'Subtle transitions on hover / focus / press (150–250ms)',
    'No decorative or looping animations',
    'Respect prefers-reduced-motion'
  ]);
  br(lines);

  push(lines, `# IMPLEMENTATION REQUIREMENTS`);
  bulletList(lines, spec.implementationRequirements, [
    'Complete, runnable React application',
    'All code inside a single project with clear file boundaries',
    'No unused imports, no dead code',
    'Consistent naming and folder structure'
  ]);
  br(lines);

  push(lines, `# VISUAL CONSTRAINTS`);
  bulletList(lines, spec.visualConstraints);
  br(lines);

  push(lines, `# FINAL REQUIREMENTS`);
  bulletList(lines, spec.finalRequirements);

  if (spec.assumptions?.length) {
    br(lines);
    push(lines, `# ASSUMPTIONS MADE`);
    bulletList(lines, spec.assumptions);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* --------------------------- tiny formatting utils --------------------------- */

function push(lines, s) { if (s !== undefined && s !== null) lines.push(String(s)); }
function br(lines)      { lines.push(''); }
function bulletList(lines, items, fallback = []) {
  const list = (items && items.length ? items : fallback).filter(Boolean);
  if (!list.length) return;
  list.forEach(x => lines.push(`- ${x}`));
}
function uniq(arr) { return Array.from(new Set(arr)); }

module.exports = { compose };
