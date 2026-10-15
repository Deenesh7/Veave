/**
 * VEAVE Requirement Extractor
 *
 * Calls the selected LLM to convert the analyzed user prompt into a
 * strictly structured UISpec JSON object. Attempts JSON mode, retries
 * once on failure, and always returns a schema-shaped result (even if
 * the LLM under-delivers) so downstream stages remain deterministic.
 */

const llmService = require('../llm');
const { VEAVE_DESIGN_SYSTEM } = require('./veaveDesignSystem');
const logger = require('../../utils/logger');

const SYSTEM_INSTRUCTION = `You are the VEAVE Requirement Extractor.
Your job is to read a natural-language product request and produce a
STRICTLY structured UI specification for a downstream React/Tailwind
code generator.

Rules:
1. Return a SINGLE valid JSON object. No markdown, no commentary.
2. Do NOT invent major functionality the user did not request.
   Only add supporting UI/UX when strictly necessary (e.g. login form
   if the user asked for roles/logins).
3. Prefer concrete, implementation-ready phrasing. No vague words
   such as "modern" — describe the concrete UI element.
4. Preserve any user-specified technology stack.
5. If the user gave role/login requirements, include auth pages.
6. Prefer 3–8 pages, 6–20 components, 4–12 features unless the
   request clearly requires otherwise.

Schema (all fields required, use [] or "" when nothing applies):
{
  "project": string,
  "objective": string,
  "productType": string,
  "targetUsers": string[],
  "technology": {
    "framework": string, "language": string, "styling": string,
    "bundler": string, "icons": string, "extras": string[]
  },
  "pages": [
    { "name": string, "route": string, "purpose": string,
      "layout": string, "sections": string[],
      "components": string[], "interactions": string[] }
  ],
  "routes": string[],
  "navigation": string,
  "components": [
    { "name": string, "description": string,
      "props": string[], "variants": string[], "states": string[] }
  ],
  "features": string[],
  "interactions": string[],
  "states": string[],
  "forms": [
    { "name": string, "fields": string[],
      "validation": string[], "submitAction": string }
  ],
  "authentication": string,
  "integrations": string[],
  "dataRequirements": [
    { "entity": string, "fields": string[], "relationships": string[] }
  ],
  "responsive": {
    "breakpoints": string[], "mobile": string,
    "tablet": string, "desktop": string
  },
  "accessibility": {
    "contrastAA": boolean, "semanticHtml": boolean,
    "ariaLabels": boolean, "keyboardNav": boolean,
    "focusVisible": boolean, "notes": string[]
  },
  "animations": string[],
  "implementationRequirements": string[],
  "assumptions": string[]
}`;

function buildUserMessage(analyzed, opts) {
  const {
    userPrompt, normalized, productType, roles, explicitTech
  } = analyzed;

  return [
    `USER REQUEST:\n"""${normalized}"""`,
    '',
    `Deterministic hints from static analysis (may be empty; use as guidance only):`,
    `- productType: ${productType}`,
    `- detectedRoles: ${JSON.stringify(roles)}`,
    `- explicitTechnology: ${JSON.stringify(explicitTech)}`,
    '',
    `Target design system: ${opts.designSystemName || 'veave'} (the visual system will be applied AFTER extraction; do not re-describe colors here).`,
    `Preferred framework: ${opts.framework || 'react'} (respect user override if present in request).`,
    analyzed.hasReferenceImage
      ? 'A reference screenshot was provided and is the visual source of truth. Reproduce its visible composition, text, branding, image placement and crop, dimensions, hierarchy, spacing, typography, colors, borders, shadows, and component structure as accurately as possible. Do not redesign, modernize, add sections, remove visible elements, or substitute a preferred design system for what is visible. Ignore only obvious capture artifacts such as an editor selection outline.'
      : 'No reference screenshot was provided.',
    '',
    'Produce the JSON UISpec now.'
  ].join('\n');
}

/**
 * @param {ReturnType<import('./promptAnalyzer').analyze>} analyzed
 * @param {{ preference?: string, framework?: string,
 *           designSystemName?: string, referenceImage?: object }} opts
 * @returns {Promise<{ spec: object, provider: string, model: string, usage: object, raw: string }>}
 */
async function extract(analyzed, opts = {}) {
  const provider = llmService.getProvider(opts.preference);

  const callArgs = {
    system: SYSTEM_INSTRUCTION,
    user: buildUserMessage(analyzed, opts),
    temperature: 0.35,
    maxTokens: 6000,
    image: opts.referenceImage || undefined
  };

  let structured;
  try {
    structured = await provider.generateStructured(callArgs);
  } catch (err) {
    logger.warn(`Extractor first-attempt failed: ${err.message}. Retrying with lower creativity.`);
    structured = await provider.generateStructured({ ...callArgs, temperature: 0.15 });
  }

  const spec = coerceSpec(structured.data, analyzed, opts);

  return {
    spec,
    provider: provider.name,
    model: provider.model,
    usage: structured.usage || {},
    raw: structured.raw
  };
}

/**
 * Guarantee shape. Fills missing keys with schema-safe defaults derived
 * from static analysis so downstream stages never crash.
 */
function coerceSpec(raw, analyzed, opts) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const dt = VEAVE_DESIGN_SYSTEM.defaultTechnology;

  const spec = {
    project: str(src.project) || defaultProjectName(analyzed),
    objective: str(src.objective) || analyzed.normalized.split('\n')[0],
    productType: str(src.productType) || analyzed.productType,
    targetUsers: arr(src.targetUsers, analyzed.roles.length ? analyzed.roles : ['end user']),
    technology: {
      framework: str(src?.technology?.framework) || opts.framework || analyzed.explicitTech.framework || dt.framework,
      language:  str(src?.technology?.language)  || analyzed.explicitTech.language  || dt.language,
      styling:   str(src?.technology?.styling)   || analyzed.explicitTech.styling   || dt.styling,
      bundler:   str(src?.technology?.bundler)   || dt.bundler,
      icons:     str(src?.technology?.icons)     || dt.icons,
      extras: arr(src?.technology?.extras, [])
    },
    pages: normalizePages(src.pages),
    routes: arr(src.routes, []),
    navigation: str(src.navigation),
    components: normalizeComponents(src.components),
    features: arr(src.features, []),
    interactions: arr(src.interactions, []),
    states: arr(src.states, ['loading', 'empty', 'error', 'success']),
    forms: normalizeForms(src.forms),
    authentication: str(src.authentication),
    integrations: arr(src.integrations, []),
    dataRequirements: normalizeData(src.dataRequirements),
    responsive: {
      breakpoints: arr(src?.responsive?.breakpoints, ['sm', 'md', 'lg', 'xl']),
      mobile: str(src?.responsive?.mobile),
      tablet: str(src?.responsive?.tablet),
      desktop: str(src?.responsive?.desktop)
    },
    accessibility: {
      contrastAA: bool(src?.accessibility?.contrastAA, true),
      semanticHtml: bool(src?.accessibility?.semanticHtml, true),
      ariaLabels: bool(src?.accessibility?.ariaLabels, true),
      keyboardNav: bool(src?.accessibility?.keyboardNav, true),
      focusVisible: bool(src?.accessibility?.focusVisible, true),
      notes: arr(src?.accessibility?.notes, [])
    },
    animations: arr(src.animations, []),
    implementationRequirements: arr(src.implementationRequirements, []),
    assumptions: arr(src.assumptions, [])
  };

  if (!spec.routes.length && spec.pages.length) {
    spec.routes = spec.pages.map(p => p.route).filter(Boolean);
  }
  return spec;
}

/* --------------------------- coercion helpers --------------------------- */

function str(v)             { return typeof v === 'string' ? v.trim() : ''; }
function bool(v, d)         { return typeof v === 'boolean' ? v : d; }
function arr(v, d)          { return Array.isArray(v) ? v.filter(Boolean).map(x => (typeof x === 'string' ? x.trim() : x)).filter(Boolean) : d; }

function normalizePages(v) {
  if (!Array.isArray(v)) return [];
  return v.map(p => ({
    name: str(p?.name),
    route: str(p?.route),
    purpose: str(p?.purpose),
    layout: str(p?.layout),
    sections: arr(p?.sections, []),
    components: arr(p?.components, []),
    interactions: arr(p?.interactions, [])
  })).filter(p => p.name);
}
function normalizeComponents(v) {
  if (!Array.isArray(v)) return [];
  return v.map(c => ({
    name: str(c?.name),
    description: str(c?.description),
    props: arr(c?.props, []),
    variants: arr(c?.variants, []),
    states: arr(c?.states, [])
  })).filter(c => c.name);
}
function normalizeForms(v) {
  if (!Array.isArray(v)) return [];
  return v.map(f => ({
    name: str(f?.name),
    fields: arr(f?.fields, []),
    validation: arr(f?.validation, []),
    submitAction: str(f?.submitAction)
  })).filter(f => f.name || f.fields.length);
}
function normalizeData(v) {
  if (!Array.isArray(v)) return [];
  return v.map(d => ({
    entity: str(d?.entity),
    fields: arr(d?.fields, []),
    relationships: arr(d?.relationships, [])
  })).filter(d => d.entity);
}

function defaultProjectName(analyzed) {
  const first = analyzed.normalized.split(/[.!?\n]/)[0] || 'VEAVE Application';
  return first.slice(0, 60).trim();
}

module.exports = { extract };
