/**
 * VEAVE Prompt Validator
 *
 * Ensures the compiled prompt & UISpec contain the sections a UI-generation
 * LLM will need. Returns { ok, warnings, missing } — the orchestrator decides
 * whether to regenerate/complete based on the outcome.
 */

const REQUIRED_SPEC_SECTIONS = [
  'project', 'objective', 'targetUsers',
  'technology', 'pages', 'components', 'features',
  'interactions', 'responsive', 'accessibility',
  'designSystem', 'implementationRequirements'
];

const REQUIRED_PROMPT_HEADINGS = [
  '# PROJECT',
  '# OBJECTIVE',
  '# TARGET USERS',
  '# TECHNOLOGY',
  '# ROUTES',
  '# PAGE DESIGN',
  '# COMPONENTS',
  '# FUNCTIONALITY',
  '# USER INTERACTIONS',
  '# STATES',
  '# VISUAL DESIGN SYSTEM',
  '# IMAGE, TEXT AND CARD CONSISTENCY',
  '# TYPOGRAPHY',
  '# COLOR SYSTEM',
  '# RESPONSIVE DESIGN',
  '# ACCESSIBILITY',
  '# ANIMATIONS',
  '# IMPLEMENTATION REQUIREMENTS',
  '# VISUAL CONSTRAINTS',
  '# FINAL REQUIREMENTS'
];

const VAGUE_TERMS = ['make it modern', 'make it nice', 'make it pretty', 'as needed', 'etc.', 'and so on'];

function validate(spec, finalPrompt) {
  const missing = [];
  const warnings = [];

  // 1. Spec structural checks
  for (const key of REQUIRED_SPEC_SECTIONS) {
    const v = spec?.[key];
    if (v === undefined || v === null) {
      missing.push(`spec.${key}`);
      continue;
    }
    if (Array.isArray(v) && v.length === 0 && ['targetUsers','pages','components','features'].includes(key)) {
      warnings.push(`spec.${key} is empty`);
    }
  }

  // 2. Prompt structural checks
  for (const heading of REQUIRED_PROMPT_HEADINGS) {
    if (!finalPrompt || !finalPrompt.includes(heading)) {
      missing.push(`prompt.${heading}`);
    }
  }

  // 3. Vagueness check
  const lower = (finalPrompt || '').toLowerCase();
  VAGUE_TERMS.forEach(term => {
    if (lower.includes(term)) warnings.push(`Vague phrasing detected: "${term}"`);
  });

  // 4. Sanity checks
  if (spec?.pages?.length && !spec.pages.every(p => p.name)) {
    warnings.push('Some pages have no name');
  }
  if ((finalPrompt || '').length < 800) {
    warnings.push('Compiled prompt is unusually short');
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings
  };
}

module.exports = { validate, REQUIRED_SPEC_SECTIONS, REQUIRED_PROMPT_HEADINGS };
