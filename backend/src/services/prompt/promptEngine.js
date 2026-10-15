/**
 * VEAVE Prompt Engine — orchestrator.
 *
 *   User Prompt
 *      → Analyze Requirements     (promptAnalyzer)
 *      → Extract UISpec via LLM   (requirementExtractor)
 *      → Apply Design System      (designSystemProcessor)
 *      → Compose Final Prompt     (promptComposer)
 *      → Validate                 (promptValidator, one auto-repair pass)
 *
 * Returns everything a controller / caller needs to persist or return.
 */

const { analyze }   = require('./promptAnalyzer');
const { extract }   = require('./requirementExtractor');
const { apply }     = require('./designSystemProcessor');
const { compose }   = require('./promptComposer');
const { validate } = require('./promptValidator');
const logger = require('../../utils/logger');
const { ValidationError, AIError } = require('../../utils/errors');

/**
 * @param {object} input
 * @param {string} input.userPrompt
 * @param {string} [input.framework]
 * @param {string} [input.designSystem]         preset name (veave | minimal | enterprise)
 * @param {string} [input.model]                'auto' | 'gpt' | 'claude' | 'gemini' | 'openrouter'
 * @param {object} [input.referenceImage]       { base64, mimeType, size }
 * @param {object} [input.projectContext]       optional existing project context
 * @returns {Promise<{
 *   analyzed: object,
 *   spec: object,
 *   finalPrompt: string,
 *   validation: object,
 *   provider: string,
 *   model: string,
 *   usage: object,
 *   durationMs: number
 * }>}
 */
async function run(input) {
  const start = Date.now();

  if (!input || typeof input !== 'object') {
    throw new ValidationError('Prompt engine input is required.');
  }
  const {
    userPrompt,
    framework = 'react',
    designSystem = 'veave',
    model = 'auto',
    referenceImage,
    projectContext,
    preserveReferenceDesign = false
  } = input;

  /* ---------- 1. Analyze ---------- */
  const analyzed = analyze(userPrompt, { referenceImage });

  /* ---------- 2. Extract ---------- */
  let extraction;
  try {
    extraction = await extract(analyzed, {
      preference: model,
      framework,
      designSystemName: designSystem,
      referenceImage
    });
  } catch (err) {
    logger.error(`PromptEngine extraction failed: ${err.message}`);
    throw err instanceof AIError ? err : new AIError('Requirement extraction failed');
  }

  let spec = extraction.spec;

  /* ---------- 2b. Fold in project context ---------- */
  if (projectContext && typeof projectContext === 'object') {
    if (projectContext.name && !spec.project) spec.project = String(projectContext.name);
    if (Array.isArray(projectContext.assumptions)) {
      spec.assumptions = [...(spec.assumptions || []), ...projectContext.assumptions];
    }
    if (projectContext.notes) {
      spec.assumptions = [...(spec.assumptions || []), `Project context: ${projectContext.notes}`];
    }
  }

  /* ---------- 3. Apply Design System ---------- */
  spec = apply(spec, designSystem, { preserveReferenceDesign });

  /* ---------- 4. Compose ---------- */
  let finalPrompt = compose(spec);

  /* ---------- 5. Validate + optional single repair pass ---------- */
  let validation = validate(spec, finalPrompt);
  if (!validation.ok) {
    logger.warn(`PromptEngine validation missing: ${validation.missing.join(', ')}. Running auto-repair.`);
    spec = repairSpec(spec);
    finalPrompt = compose(spec);
    validation = validate(spec, finalPrompt);
  }

  return {
    analyzed,
    spec,
    finalPrompt,
    validation,
    provider: extraction.provider,
    model: extraction.model,
    usage: extraction.usage || {},
    durationMs: Date.now() - start
  };
}

/**
 * Deterministic single-pass repair: fill in sensible defaults for anything
 * the extractor left out so the validator can pass.
 */
function repairSpec(spec) {
  const s = { ...spec };
  if (!s.project)     s.project     = 'VEAVE Application';
  if (!s.objective)   s.objective   = 'Build the described application with a production-ready UI.';
  if (!s.productType) s.productType = 'application';
  if (!Array.isArray(s.targetUsers) || !s.targetUsers.length) s.targetUsers = ['end user'];

  if (!s.technology) s.technology = {};
  s.technology.framework = s.technology.framework || 'react';
  s.technology.language  = s.technology.language  || 'javascript';
  s.technology.styling   = s.technology.styling   || 'tailwindcss';
  s.technology.bundler   = s.technology.bundler   || 'vite';
  s.technology.icons     = s.technology.icons     || 'lucide-react';
  s.technology.extras    = s.technology.extras    || [];

  if (!s.pages || !s.pages.length) {
    s.pages = [{
      name: 'Home', route: '/', purpose: 'Primary landing view for the application.',
      layout: 'Header + main content + footer', sections: ['Header', 'Main', 'Footer'],
      components: ['Header', 'MainContent', 'Footer'], interactions: ['Primary CTA click']
    }];
  }
  if (!s.routes || !s.routes.length) s.routes = s.pages.map(p => p.route).filter(Boolean);

  if (!s.components || !s.components.length) {
    s.components = [
      { name: 'Header',      description: 'App-wide navigation bar', props: ['links'], variants: [], states: [] },
      { name: 'MainContent', description: 'Primary page content region', props: [], variants: [], states: ['loading','empty','error'] },
      { name: 'Footer',      description: 'App-wide footer', props: [], variants: [], states: [] }
    ];
  }

  if (!s.features?.length)      s.features      = ['Render the described pages with real, plausible content'];
  if (!s.interactions?.length)  s.interactions  = ['Primary CTA click', 'Navigate between pages'];
  if (!s.states?.length)        s.states        = ['loading', 'empty', 'error', 'success'];

  if (!s.responsive) s.responsive = {};
  s.responsive.breakpoints = s.responsive.breakpoints?.length ? s.responsive.breakpoints : ['sm','md','lg','xl'];

  if (!s.accessibility) s.accessibility = {};
  ['contrastAA','semanticHtml','ariaLabels','keyboardNav','focusVisible'].forEach(k => {
    if (typeof s.accessibility[k] !== 'boolean') s.accessibility[k] = true;
  });

  if (!s.implementationRequirements?.length) {
    s.implementationRequirements = [
      'Complete, runnable React application',
      'Consistent naming and folder structure',
      'No unused imports or dead code'
    ];
  }
  return s;
}

module.exports = { run };
