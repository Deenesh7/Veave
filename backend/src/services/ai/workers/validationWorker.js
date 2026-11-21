/**
 * Validation worker: everything that decides whether a generated project may be delivered.
 *
 *   validateCandidate    dedupe -> image localisation -> completeness / image / page / layout checks and repair -> build and browser
 *                        validation -> target, page and visual verification. Returns { files, report } or throws a classified error.
 *   completeSite         the completeness and self-repair loop (pictures, pages, layout) used by validateCandidate
 *   checkRendered*, reviewRenderedLayout   the rendered-page, rendered-image and layout inspections
 *
 * It never writes the job or the project. A failed validation throws, so the orchestrator cannot commit an invalid project.
 * The model-backed repair call is injected (`requestGeneratedCodeRepair`) because the clone flows share it.
 */
const GenerationJob = require('../../../models/GenerationJob');
const routingValidation = require('.././routingValidation');
const generationPipeline = require('.././generationPipeline');
const { validateAndRepair, sourceHash } = require('.././validationGate');
const { checkCompleteness, imagesExempt } = require('.././siteCompleteness');
const duplicateGuard = require('../../clone/duplicateGuard');
const { executeProject, isDockerAvailable, decodeVisualReference } = require('.././executionRunner');
const { findHiddenContent, verifyPreviewRuntime, verifyPreviewVisual, verifyRenderedTarget, verifyPageIsolation, detectBlankSpaceBatch, inspectRenderedPreview } = require('.././targetRenderVerifier');
const imageDiscovery = require('.././images/imageDiscoveryService');
const imageValidation = require('.././images/imageValidation');
const imageRecovery = require('.././images/imageRecovery');
const { imageConfig, applyFloor } = require('.././images/imageConfig');
const visualReview = require('.././composition/visualReview');
const pageDistinctness = require('.././pageDistinctness');
const { publishPreview } = require('../../project/validatedPreview');
const logger = require('../../../utils/logger');
const { timed } = require('../jobSupport/stageTimer');
const {
  AppError,
  AIError,
  OpenRouterAuthError,
  OpenRouterRateLimitError,
  OpenRouterTimeoutError,
  OpenRouterModelError,
  isPermanentProviderError,
  AIResponseValidationError,
  AIResponseMalformedError,
  FileApplicationError,
  RepairExhaustedError
} = require('../../../utils/errors');
const { REVIEW } = require('../composition/layoutCatalog');

const remoteImageLocalizer = require('../remoteImageLocalizer');

const REVIEW_BLOCKING_KINDS = new Set(REVIEW.blocking);

function requiresDockerForVisualReference(visualReference, allowLocalVisualFallback = false) {
  return Boolean(visualReference && !allowLocalVisualFallback);
}

function isAdvisoryRenderFailure(diagnostics = []) {
  return Array.isArray(diagnostics) && diagnostics.length > 0 && diagnostics.every((item) =>
    item?.category === 'route-color'
    || item?.category === 'missing-asset'
    || (item?.category === 'route-content' && /^Expected heading was not rendered/i.test(String(item.message || ''))));
}

// A generated website references images by public link. Those images are downloaded into the project (and stored in S3 when it
// is saved), because the preview/validation sandbox does not load other websites and the links are not ours to depend on.
async function localizeGeneratedImages(files, signal) {
  const textPaths = files.filter((file) => file && file.encoding !== 'base64' && /\.(?:jsx?|tsx?|css|html)$/i.test(file.path || '')).map((file) => file.path);
  const result = await remoteImageLocalizer.localizeIntroducedRemoteImages({
    beforeFiles: [], files: files.map((file) => ({ ...file })), changedPaths: textPaths, skipFailed: true, signal
  });
  return { files: result.files, failed: result.failed || [], downloaded: result.added.length, skipped: (result.skipped || []).length };
}


class ValidationWorker {
  constructor({ requestGeneratedCodeRepair }) {
    this.requestGeneratedCodeRepair = requestGeneratedCodeRepair;
  }

  async validateCandidate(files, { model, tokens, signal, onProgress, targetVerification = null, pageVerification = null, cloneRoutes = [],
    visualReference = null, allowLocalVisualFallback = false, completeness = null, baselineFiles = null, localizeImages = false,
    visualThreshold = null, visualTarget = null, repairContext = null, visualAdvisory = false, templateCheck = null, timingScope = null } = {}) {
    const scope = timingScope || completeness?.imageContext?.jobId || '';
    // Strict duplicate handling: byte-identical asset files are merged deterministically (references rewritten); anything
    // that cannot be merged mechanically (colliding paths, a route registered twice, a copied component) goes to the model.
    let brokenImageLinks = [];
    const imageContext = completeness?.imageContext || null;
    // The verified pictures found before generation belong to the project from the start, so references to them resolve.
    if (imageContext?.files?.length) files = imageDiscovery.mergeAssetFiles(files, imageContext.files);
    if (localizeImages) {
      const localized = await timed('localize-images', () => localizeGeneratedImages(files, signal), scope);
      files = localized.files;
      brokenImageLinks = localized.failed;
      if (localized.downloaded) logger.info(`Saved ${localized.downloaded} generated image(s) into the project${localized.skipped ? ` (${localized.skipped} unreachable link(s) left out)` : ''}.`);
    }
    const merged = duplicateGuard.enforceUniqueProjectFiles(files);
    files = merged.files;
    const baseline = new Set((baselineFiles ? duplicateGuard.findProjectDuplicates(baselineFiles) : []).map((issue) => `${issue.kind}|${issue.message}`));
    const completenessReport = (completeness || duplicateGuard.findProjectDuplicates(files).some((issue) => !baseline.has(`${issue.kind}|${issue.message}`)))
      ? await this.completeSite(files, { ...(completeness || {}), timingScope: scope, enforceCompleteness: Boolean(completeness), baseline, model, tokens, signal, localizeImages, brokenImageLinks, routeCheck: completeness && localizeImages && process.env.MULTIPAGE_RENDER_CHECK !== 'false' ? (candidate) => this.checkRenderedPages(candidate, { signal, spec: completeness.spec }) : null, imageContext, imageRenderCheck: imageContext && imageConfig().renderCheck ? (candidate, info) => this.checkRenderedImages(candidate, { signal, info, floor: imageContext.floor }) : null, layoutReview: completeness && localizeImages && process.env.LAYOUT_REVIEW !== 'false' ? (candidate) => this.reviewRenderedLayout(candidate, { signal, plan: completeness.compositionPlan }) : null })
      : null;
    if (completenessReport) {
      files = completenessReport.files;
      // Discovered pictures no page ended up using are not kept in the project.
      if (imageContext?.assets?.length) files = imageDiscovery.pruneUnused(files, imageContext.assets).files;
      const leftover = completenessReport.summary.remaining.filter((issue) => issue.kind === 'duplicate' || String(issue.kind).startsWith('path-') || ['route', 'file-content', 'path-case'].includes(issue.kind));
      if (leftover.length) throw new AIResponseValidationError(`Duplicate check failed after repair: ${leftover.map((issue) => issue.message).join(' ')}`);
      const pageIssues = completenessReport.summary.remaining.filter((issue) => pageDistinctness.BLOCKING_KINDS.has(issue.kind));
      if (pageIssues.length) throw new AIResponseValidationError(`Page check failed: the website was not created because its pages are not distinct. ${pageIssues.map((issue) => issue.message).join(' ')}`.slice(0, 1500));
      const layoutBlocking = completenessReport.summary.remaining.filter((issue) => String(issue.kind).startsWith('layout-') && REVIEW_BLOCKING_KINDS.has(issue.kind));
      if (layoutBlocking.length && String(process.env.LAYOUT_REVIEW_BLOCKING || 'false').toLowerCase() !== 'false') throw new AIResponseValidationError(`Layout check failed: the website was not created because its rendered pages have layout defects that could not be repaired. ${layoutBlocking.slice(0, 4).map((issue) => issue.message).join(' ')}`.slice(0, 1800));
      const imageIssues = completenessReport.summary.remaining.filter((issue) => issue.kind === 'images');
      // Self-healing: recovery (placement, discovery, forced gallery placement) already ran; a remaining shortfall is logged, never shown to the user as a failed build.
      if (imageIssues.length && String(process.env.IMAGE_CHECK_BLOCKING || 'false').toLowerCase() === 'true') throw new AIResponseValidationError(`Image check failed: the website was not created because it does not have working images after ${imageConfig().recoveryAttempts} recovery attempt(s). ${imageIssues.map((issue) => issue.message).join(' ')}${completenessReport.imageDiagnostic ? `\n${completenessReport.imageDiagnostic}` : ''}`.slice(0, 2400));
      else if (imageIssues.length) logger.warn(`Image check not fully satisfied after recovery; delivering the website anyway. ${imageIssues.map((issue) => issue.message).join(' ').slice(0, 600)}`);
    }
    let requireExecution = false;
    const dockerRequiredForVisual = requiresDockerForVisualReference(visualReference, allowLocalVisualFallback);
    if (dockerRequiredForVisual) {
      requireExecution = true;
    } else if (process.env.ENABLE_DOCKER_VALIDATION === 'true') {
      requireExecution = true;
    } else if (process.env.ENABLE_DOCKER_VALIDATION === 'false') {
      requireExecution = false;
    } else {
      requireExecution = await isDockerAvailable();
    }

    if (!requireExecution) {
      logger.info('Docker execution validator is unavailable or disabled; using local browser preview validation.');
    }

    const validationPlanPath = 'veave.validation.json';
    const validationTests = [];
    if (targetVerification && targetVerification.cssValue === undefined) {
      validationTests.push({
        name: 'Requested target style',
        path: '/',
        viewports: ['desktop'],
        steps: [{
          action: 'assert',
          selector: targetVerification.selector,
          targetText: targetVerification.targetText,
          visible: true,
          ...(targetVerification.expectedText !== undefined
            ? { text: targetVerification.expectedText }
            : { style: { property: targetVerification.property, value: targetVerification.value } })
        }]
      });
    }
    if (pageVerification) {
      const sharedInitial = [
        ...(pageVerification.headerSelector ? [{ action: 'assert', selector: pageVerification.headerSelector, visible: true, count: 1 }] : []),
        ...(pageVerification.footerSelector ? [{ action: 'assert', selector: pageVerification.footerSelector, visible: true, count: 1 }] : [])
      ];
      validationTests.push({
        name: 'Page layout isolation',
        path: '/',
        viewports: ['desktop'],
        steps: [
          { action: 'assert', selector: pageVerification.homeSelector, visible: true },
          { action: 'assert', selector: pageVerification.pageSelector, visible: false },
          ...sharedInitial,
          { action: 'click', selector: pageVerification.openSelector },
          { action: 'assert', selector: pageVerification.pageSelector, visible: true },
          { action: 'assert', selector: pageVerification.homeSelector, visible: false },
          ...sharedInitial,
          { action: 'click', selector: pageVerification.homeLinkSelector },
          { action: 'assert', selector: pageVerification.homeSelector, visible: true },
          { action: 'assert', selector: pageVerification.pageSelector, visible: false },
          ...sharedInitial
        ]
      });
    }
    for (const route of cloneRoutes) {
      // Fatal check: the route renders. Heading wording is a fidelity expectation checked (advisorily) while pages are built.
      const steps = [{ action: 'assert', selector: '#root', visible: true }];
      validationTests.push({
        name: `Clone route ${route.path}`,
        path: route.path,
        viewports: ['desktop', 'mobile'],
        steps
      });
    }
    const validationFiles = validationTests.length
      ? [
          ...files.filter((file) => file.path !== validationPlanPath),
          {
            path: validationPlanPath,
            language: 'json',
            content: JSON.stringify({
              version: 1,
              tests: validationTests
            }, null, 2)
          }
        ]
      : files;

    const validated = await validateAndRepair(validationFiles, {
      signal,
      onProgress,
      requireExecution: true,
      maxRepairs: Number.parseInt(process.env.VALIDATION_MAX_REPAIRS, 10) || 3,
      requireArtifacts: requireExecution,
      extraStaticChecks: templateCheck ? (current) => templateCheck.check(current) : null,
       run: requireExecution
         ? async (current, options) => {
             const outcome = await timed('build-and-browser-check', () => executeProject(current, { ...options, visualReference: visualAdvisory ? null : visualReference, ...(visualThreshold ? { visualThreshold } : {}) }), scope);
             // The isolated runner itself failed (Docker went away or timed out mid-run): this says nothing about the
             // generated code. Verify it in the local browser instead, and record that the build runner did not run.
             // Screenshot comparisons that need the runner are never downgraded.
             if (outcome?.infrastructure && !dockerRequiredForVisual) {
               logger.warn(`Docker validation infrastructure failed (${outcome.diagnostics?.[0]?.message}); using local browser preview validation.`);
               const local = await verifyPreviewRuntime(current, options);
               return {
                 ...local,
                 degradedExecution: true,
                 infrastructure: outcome.diagnostics,
                 checks: [
                   { name: 'execution', status: 'infrastructure_unavailable', reason: outcome.diagnostics?.[0]?.message },
                   { name: 'build', status: 'skipped', reason: 'Isolated build runner unavailable; only the local browser runtime check ran.' },
                   ...(local.checks || [])
                 ]
               };
             }
             return outcome;
           }
         : (current, options) => verifyPreviewRuntime(current, options),
       repair: (current, diagnostics, history) => timed('build-repair-model-call', () => this.requestGeneratedCodeRepair(current, diagnostics, model, tokens, history, visualReference, { sourceContext: [repairContext ? repairContext(diagnostics, current) : '', templateCheck ? templateCheck.repairContext(diagnostics, current) : ''].filter(Boolean).join('\n\n') || null }), imageContext?.jobId)
    });

    // If the runner failed mid-validation the local verifier produced this result: post-checks must use that path.
    if (requireExecution && validated.report.validationMode === 'local-browser-fallback') requireExecution = false;
    if (!requireExecution) {
      validated.report.validationMode = 'local-browser-fallback';
      if (!(validated.report.checks || []).some((check) => check.name === 'build')) {
        validated.report.checks = [...(validated.report.checks || []), {
          name: 'build', status: 'skipped', reason: 'Isolated build runner unavailable or disabled; only the local browser runtime check ran.'
        }];
      }
    }

    // Clones: the screenshot comparison is a quality measurement, not a gate. A site that builds, renders and has all its pages
    // is delivered, with the similarity (and any shortfall against the target) recorded. Screenshot jobs keep the hard gate.
    if (visualAdvisory && visualReference && validated.report.status === 'passed') {
      try {
        const compared = await verifyPreviewVisual(validated.files, { signal, routePath: '/', reference: visualReference, threshold: 0.5 });
        const score = compared.comparison?.score;
        if (Number.isFinite(score)) {
          validated.report.visual = { passed: score >= (visualTarget || 0), score, threshold: visualTarget || null, advisory: true };
          if (visualTarget && score < visualTarget) validated.report.visualWarning = { score, target: visualTarget, accepted: 'advisory' };
        }
      } catch (visualError) {
        if (signal?.aborted || visualError?.name === 'AbortError') throw visualError;
        validated.report.checks = [...(validated.report.checks || []), { name: 'visual-comparison', status: 'skipped', reason: `Similarity could not be measured: ${visualError.message}` }];
      }
    }

    // A clone is accepted at its minimum similarity; anything under the target is recorded, not hidden.
    if (visualTarget && validated.report.visual && Number.isFinite(validated.report.visual.score) && validated.report.visual.score < visualTarget) {
      validated.report.visualWarning = { score: validated.report.visual.score, target: visualTarget, accepted: visualThreshold || null };
    }

    if (visualReference && !requireExecution) {
      validated.report.checks = [...(validated.report.checks || []), {
        name: 'visual-comparison',
        status: 'skipped',
        reason: 'Docker validator unavailable; local Chromium runtime validation passed.'
      }];
      validated.report.visual = null;
      validated.report.validationMode = 'local-browser-fallback';
    }

    if (targetVerification) {
      if (requireExecution && targetVerification.cssValue === undefined) {
        const targetCheck = validated.report?.checks?.find((check) =>
          check.name === 'plan' && check.test === 'Requested target style'
        );
        if (!targetCheck || targetCheck.status !== 'passed') {
          throw new AIResponseValidationError('Rendered target verification failed: the requested visual property was not confirmed in the browser.');
        }
      } else {
        try {
          const rendered = await verifyRenderedTarget(validated.files, targetVerification, { signal });
          validated.report.checks = [...(validated.report.checks || []), {
            name: 'target-render',
            status: 'passed',
            target: targetVerification.targetText,
            actual: rendered.actual
          }];
        } catch (error) {
          throw new AIResponseValidationError(`Rendered target verification failed: ${error.message}`);
        }
      }
      validated.files = validated.files.filter((file) => file.path !== validationPlanPath);
      if (Array.isArray(validated.artifacts)) {
        validated.artifacts = validated.artifacts.filter((file) => file.path !== validationPlanPath);
      }
      validated.report.targetVerification = { ...targetVerification, status: 'passed' };
    }

    if (pageVerification) {
      if (requireExecution) {
        const pageCheck = validated.report?.checks?.find((check) =>
          check.name === 'plan' && check.test === 'Page layout isolation'
        );
        if (!pageCheck || pageCheck.status !== 'passed') {
          throw new AIResponseValidationError('Rendered page isolation verification failed: route exclusivity was not confirmed in the browser.');
        }
      } else {
        try {
          await verifyPageIsolation(validated.files, pageVerification, { signal });
          validated.report.checks = [...(validated.report.checks || []), {
            name: 'page-isolation-render', status: 'passed', page: pageVerification.slug
          }];
        } catch (error) {
          throw new AIResponseValidationError(`Rendered page isolation verification failed: ${error.message}`);
        }
      }
      validated.report.pageVerification = { ...pageVerification, status: 'passed' };
    }

    if (cloneRoutes.length) {
      const routeChecks = requireExecution
        ? cloneRoutes.map((route) => ({
            path: route.path,
            pageType: route.pageType,
            desktop: validated.report?.checks?.some((check) => check.name === 'plan' && check.test === `Clone route ${route.path}` && check.viewport === 'desktop' && check.status === 'passed') || false,
            mobile: validated.report?.checks?.some((check) => check.name === 'plan' && check.test === `Clone route ${route.path}` && check.viewport === 'mobile' && check.status === 'passed') || false
          }))
        : await Promise.all(cloneRoutes.map(async (route) => {
            const registered = route.derived || route.path === '/' || validated.files.some((file) => file.encoding !== 'base64' && String(file.content || '').includes(JSON.stringify(route.path)));
            const runtime = registered
              ? await verifyPreviewRuntime(validated.files, { signal, routePath: route.path, expectedHeading: route.expectedHeading, minimumTextLength: route.derived ? 0 : 200, expectedColors: route.expectedColors })
              : { ok: false, diagnostics: [{ category: 'route-content', path: route.path, message: 'Route is not registered.' }] };
            // A route that renders but misses a fidelity expectation (palette, heading wording, a broken image) is kept
            // and reported; only a route that is unregistered, errors, or renders (almost) nothing is a failure.
            const advisory = !runtime.ok && registered && isAdvisoryRenderFailure(runtime.diagnostics);
            return {
              path: route.path,
              pageType: route.pageType,
              registered,
              runtimeSmoke: runtime.ok || advisory,
              advisory,
              diagnostics: runtime.ok ? [] : runtime.diagnostics
            };
          }));
      if (requireExecution && routeChecks.some((route) => !route.desktop || !route.mobile) && cloneRoutes.every((route) => !route.derived)) {
        throw new AIResponseValidationError('One or more cloned routes failed desktop or mobile browser validation.');
      }
      // Routes derived from a created site's own <Route> tags are advisory: they are reported, never fatal.
      if (!requireExecution && routeChecks.some((route) => !route.registered || !route.runtimeSmoke) && cloneRoutes.every((route) => !route.derived)) {
        const failed = routeChecks.filter((route) => !route.registered || !route.runtimeSmoke);
        throw new AIResponseValidationError(`Generated clone failed route rendering: ${JSON.stringify(failed)}`);
      }
      validated.report.cloneCoverage = {
        expectedRoutes: cloneRoutes.length,
        validatedRoutes: routeChecks.filter((route) => (route.registered && !requireExecution) || (route.desktop && route.mobile)).length,
        routes: routeChecks
      };
    }

    if (validationTests.length) {
      validated.files = validated.files.filter((file) => file.path !== validationPlanPath);
      if (Array.isArray(validated.artifacts)) validated.artifacts = validated.artifacts.filter((file) => file.path !== validationPlanPath);
    }

    if (Array.isArray(validated.artifacts) && validated.artifacts.some(f => f.path === 'dist/index.html')) {
      try {
        validated.report.previewUrl = await publishPreview(validated.artifacts, validated.report.sourceHash);
      } catch (err) {
        logger.warn(`Could not publish preview: ${err.message}`);
      }
    } else {
      validated.report.previewUrl = null;
    }

    if (completenessReport) { validated.report.completeness = completenessReport.summary; if (completenessReport.layoutSummary) validated.report.layoutReview = completenessReport.layoutSummary; }
    validated.report.duplicates = { assetFilesMerged: merged.collected, remaining: duplicateGuard.findProjectDuplicates(validated.files).filter((issue) => !baseline.has(`${issue.kind}|${issue.message}`)).map(({ kind, path, message }) => ({ kind, path, message })) };
    return validated;
  }

  /**
   * Opens every route of a new site at desktop, tablet and mobile width and measures the rendered layout: gaps, empty boxes,
   * overflow, text width, picture proportions, card heights. Returns the repairable issues (and which of them block).
   */
  async reviewRenderedLayout(files, { signal, plan = null } = {}) {
    const found = pageDistinctness.extractRoutes(files).filter((route) => route.path.startsWith('/') && !/[:*]/.test(route.path));
    const names = new Map((plan?.pages || []).map((page) => [page.route, page.name]));
    const labels = pageDistinctness.navLabels(files).labels;
    const unique = [...new Map([{ path: '/' }, ...found].map((route) => [route.path, route])).values()].slice(0, Number.parseInt(process.env.LAYOUT_REVIEW_ROUTES, 10) || 8);
    const routes = unique.map((route) => ({ path: route.path, name: names.get(route.path) || labels.get(route.path) || (route.path === '/' ? 'Home' : pageDistinctness.humanize(route.path)) }));
    const viewports = String(process.env.LAYOUT_REVIEW_VIEWPORTS || 'desktop,tablet,mobile').split(',').map((item) => item.trim()).filter(Boolean);
    return visualReview.reviewComposition(files, { routes, viewports, signal, concurrency: 3, render: (candidate, options) => inspectRenderedPreview(candidate, { signal, ...options }) });
  }

  /**
   * Opens the pages of a new site in the headless browser and checks that its pictures really render (lazy images are scrolled
   * into view first). Returns [] when the preview environment cannot render; that is not a site defect.
   */
  async checkRenderedImages(files, { signal, info = null, floor = null } = {}) {
    const cfg = applyFloor(imageConfig(), { floor });
    const routes = pageDistinctness.extractRoutes(files).filter((route) => route.path.startsWith('/') && !/[:*]/.test(route.path)).map((route) => route.path);
    return imageValidation.renderedImageReport(files, { routes: [...new Set(routes)], signal, cfg, info, render: (candidate, options) => inspectRenderedPreview(candidate, { signal, ...options }) });
  }

  /**
   * Loads every route of a new multi-page site by its own URL (what a direct visit or a browser refresh does) and compares
   * what each shows. A route that shows Home, two routes that show the same thing, or a blank route become issues that name
   * the page file to rewrite. Returns [] when the preview environment cannot render (that is not a site defect).
   */
  async checkRenderedPages(files, { signal, spec = null } = {}) {
    const routes = pageDistinctness.extractRoutes(files).filter((route) => route.path.startsWith('/') && route.path !== '/' && !/[:*]/.test(route.path));
    const unique = [...new Map(routes.map((route) => [route.path, route])).values()].slice(0, 12);
    if (unique.length < 1) return [];
    const result = await routingValidation.validateRouting({
      files, routes: unique.map((route) => ({ path: route.path })), signal,
      render: (candidate, options) => inspectRenderedPreview(candidate, { signal, ...options })
    });
    const labels = pageDistinctness.navLabels(files).labels;
    const issues = [];
    for (const issue of result.fatal) {
      if (!['route-shows-home', 'routes-identical', 'route-blank'].includes(issue.kind)) continue;
      const route = unique.find((item) => item.path === issue.route);
      const label = labels.get(issue.route) || pageDistinctness.humanize(issue.route);
      const planned = Array.isArray(spec?.pages) ? spec.pages.find((page) => page?.route === issue.route) : null;
      issues.push({
        category: 'completeness', kind: 'page-rendered-duplicate', path: route?.target || route?.file || 'src/App.jsx', routes: [issue.route],
        message: `When ${issue.route} (${label}) is opened by its own URL, the rendered page is wrong: ${issue.detail}${planned?.purpose ? ` It must be: ${planned.purpose}` : ''} Rewrite ${route?.target || 'its page component'} as a real ${label} page with its own heading, sections and content, make sure the route in src/App.jsx renders that component (not Home or a shared fallback), and keep the shared Navbar, Footer and design system.`
      });
    }
    return issues;
  }

  /**
   * A new site must have working navigation, several linked pages, real length and a footer (and honour a reference
   * site's look). The build gate cannot tell, so missing pieces are sent to the model as exact instructions, at most
   * COMPLETENESS_MAX_REPAIRS times (default 2). This phase is soft: a site that still lacks something after that is
   * kept (it passed nothing worse than being short) and the gaps are recorded on the report for the UI.
   */
  async completeSite(files, { prompt, spec, prototypeBg, entityAssets = [], entityMissing = [], routeCheck = null, imageContext = null, imageRenderCheck = null, layoutReview = null, compositionPlan = null, enforceCompleteness = true, baseline = new Set(), model, tokens, signal, localizeImages = false, brokenImageLinks = [], timingScope = null }) {
    const scope = timingScope || imageContext?.jobId || '';
    const maxRounds = Number.parseInt(process.env.COMPLETENESS_MAX_REPAIRS, 10);
    const rounds = Number.isFinite(maxRounds) ? maxRounds : 3;
    const context = { prompt, spec, prototypeBg, brokenImageLinks, entityAssets, entityMissing, compositionPlan };
    // Completeness (new sites only) plus strict duplicate rules (every candidate; duplicates already in the project are not blamed).
    const findIssues = (candidateFiles) => [
      ...(enforceCompleteness ? checkCompleteness(candidateFiles, context) : []),
      ...duplicateGuard.findProjectDuplicates(candidateFiles).filter((issue) => !baseline.has(`${issue.kind}|${issue.message}`))
    ];
    // The images the project really has (decoded, one by one), so the check counts working pictures and not <img> tags.
    const refreshImages = async (candidateFiles) => {
      if (!imageContext) return;
      context.imageFloor = imageContext.floor || null;
      context.imageInfo = await timed('inspect-project-images', () => imageValidation.inspectProjectImages(candidateFiles), scope);
      context.spareImages = imageDiscovery.spareAssets(candidateFiles, imageContext.assets || []).filter((asset) => !imageContext.unplaceable?.has(asset.id)); // pictures the relevance check withheld are never offered for placement
      context.missingImages = (imageContext.missing || []).map((item) => ({ page: item.page, section: item.section, reason: imageDiscovery.reasonFor(item.code) }));
    };
    const stageNote = (stage) => { if (imageContext?.jobId) GenerationJob.updateOne({ jobId: imageContext.jobId, status: 'processing' }, { $set: { 'analysis.imagePipeline.stage': stage } }).catch(() => {}); };
    // The rendered checks (each route loaded by its own URL, as on a refresh; then the images in the browser) only run once the
    // static checks are clean.
    const findAllIssues = async (candidateFiles) => {
      await refreshImages(candidateFiles);
      let found = findIssues(candidateFiles);
      const pageBroken = (list) => list.some((issue) => issue.kind.startsWith('page-') || issue.kind === 'pages' || issue.kind === 'routing');
      if (routeCheck && !pageBroken(found)) {
        try { found = [...found, ...await timed('route-render-check', () => routeCheck(candidateFiles), imageContext?.jobId)]; } catch (error) { if (signal?.aborted) throw error; logger.warn(`Rendered page check skipped: ${error.message}`); }
      }
      const countIssue = (issue) => issue.kind === 'images' && /^The site has \d+ image/.test(issue.message);
      const otherIssues = found.filter((issue) => !countIssue(issue) && !['image-alt', 'image-layout', 'image-overlay'].includes(issue.kind));
      if (imageRenderCheck && enforceCompleteness && !pageBroken(found) && (!found.some((issue) => issue.kind === 'images') || (found.some(countIssue) && !otherIssues.some((issue) => issue.kind === 'images')))) {
        try {
          stageNote('image_render_validation');
          const report = await timed('image-render-check', () => imageRenderCheck(candidateFiles, context.imageInfo), scope);
          context.renderedImages = { home: report.home, site: report.site, byRoute: report.byRoute };
          // The source can hide pictures from a static count (paths built at run time, data files). What the browser renders is the truth:
          // when it shows enough distinct, working pictures, the static count does not fail the site.
          const cfgNow = applyFloor(imageConfig(), imageContext);
          if (report.home !== null && report.home >= cfgNow.minHome && report.site >= cfgNow.minSite) found = found.filter((issue) => !countIssue(issue));
          found = [...found, ...report.issues.filter((issue) => !(issue.kind === 'images' && /distinct image\(s\) render/.test(issue.message) && report.home >= cfgNow.minHome && report.site >= cfgNow.minSite))];
        } catch (error) { if (signal?.aborted) throw error; logger.warn(`Rendered image check skipped: ${error.message}`); }
      }
      // Visual composition review: only on a site that is otherwise complete, so its repairs never fight the structural ones.
      if (layoutReview && enforceCompleteness && !found.some((issue) => !['image-alt', 'image-layout', 'image-overlay'].includes(issue.kind) && !issue.kind.startsWith('layout-'))) {
        try {
          stageNote('visual_review');
          const reviewed = await timed('layout-review-vision', () => layoutReview(candidateFiles), scope);
          found = [...found.filter((issue) => !issue.kind.startsWith('layout-')), ...reviewed.issues];
          context.layoutSummary = { issues: reviewed.issues.length, blocking: reviewed.blocking.length, kinds: [...new Set(reviewed.issues.map((issue) => issue.kind))], skipped: reviewed.skipped || null, metrics: reviewed.metrics };
        } catch (error) { if (signal?.aborted) throw error; logger.warn(`Visual composition review skipped: ${error.message}`); }
      }
      return found;
    };
    let current = files;
    let issues = await findAllIssues(current);
    const initial = issues.map((issue) => issue.kind);
    const history = [];
    let attempts = 0;
    // Targeted image recovery first: restore or replace failed pictures at their own paths and find more pictures when the site
    // still has too few. The model is only asked to place pictures that already exist.
    let imageDiagnostic = null;
    const recoverImages = async ({ placeOnly = false } = {}) => {
      if (!imageContext || !issues.some((issue) => issue.kind === 'images' || issue.kind === 'entity-images')) return false;
      try {
        const recovered = await timed('image-recovery', () => imageRecovery.recoverImages({ files: current, imageContext, prompt, spec, signal, placeOnly, onStage: (stage) => stageNote(stage) }), scope);
        imageDiagnostic = recovered.diagnostic;
        if (imageContext.jobId) GenerationJob.updateOne({ jobId: imageContext.jobId }, { $set: { 'analysis.imagePipeline.reconciliation': imageContext.report || null, 'analysis.imagePipeline.recoveryLog': (imageContext.recoveryLog || []).slice(-6).map(({ attempt, before, after, placed, failed, discovered, note }) => ({ attempt, before, after, placed: (placed || []).map((item) => `${item.path} -> ${item.file} (${item.strategy})`), failed, discovered, note })) } }).catch(() => {});
        logger.info(`Image recovery: ${recovered.diagnostic.replace(/\n/g, ' | ')}`);
        if (!recovered.changed) return false;
        current = recovered.files;
        issues = await findAllIssues(current);
        return true;
      } catch (error) { if (signal?.aborted) throw error; logger.warn(`Image recovery skipped: ${error.message}`); return false; }
    };
    await recoverImages();
    const layoutRounds = Number.parseInt(process.env.LAYOUT_REPAIR_ROUNDS, 10) || 4;
    for (let round = 0; issues.length && round < Math.max(rounds, issues.some((issue) => String(issue.kind).startsWith('layout-')) ? layoutRounds : 0); round++) {
      if (signal?.aborted) throw Object.assign(new Error('Validation cancelled'), { name: 'AbortError' });
      if (round > 0) await recoverImages();
      if (!issues.length) break;
      attempts++;
      let changes;
      try {
        changes = await timed('completeness-repair-model-call', () => this.requestGeneratedCodeRepair(current, issues, model, tokens, history, null, { maxTokens: Number.parseInt(process.env.COMPLETENESS_MAX_TOKENS, 10) || 16000 }), scope);
      } catch (error) {
        logger.warn(`Completeness repair unavailable: ${error.message}`);
        history.push({ attempt: attempts, failureKind: 'provider', diagnostics: [{ category: 'completeness', message: error.message }] });
        if (signal?.aborted) throw error;
        if (error instanceof OpenRouterAuthError || error instanceof OpenRouterRateLimitError) break;
        continue;
      }
      const merged = new Map(current.map((file) => [file.path, file]));
      for (const change of changes || []) merged.set(change.path, { ...merged.get(change.path), ...change });
      for (const deleted of changes?.deletedPaths || []) merged.delete(deleted);
      let candidate = [...merged.values()];
      if (localizeImages) {
        // The repair may have added new image links: download them like the first ones.
        try {
          const localized = await timed('localize-images', () => localizeGeneratedImages(candidate, signal), scope);
          candidate = localized.files;
          context.brokenImageLinks = localized.failed;
        } catch (error) {
          if (signal?.aborted) throw error;
          logger.warn(`Image download after repair failed: ${error.message}`);
        }
      }
      const unsafe = generationPipeline.validateFilePaths(candidate);
      const broken = generationPipeline.validateGeneratedFiles(candidate).filter((item) => item.category === 'syntax');
      const after = await findAllIssues(candidate);
      if (unsafe.length || broken.length || after.length > issues.length) {
        // Never trade a working site for a broken or worse one.
        history.push({ attempt: attempts, rejectedRepair: true, diagnostics: [...unsafe, ...broken, ...issues].slice(0, 8) });
        continue;
      }
      history.push({ attempt: attempts, changedFiles: (changes || []).map((change) => change.path), diagnostics: issues.slice(0, 4) });
      current = candidate;
      issues = after;
    }
    // Layout self-heal, last resort: when the model could not clear the layout defects, a guard stylesheet fixes the usual causes
    // deterministically (sideways overflow, unbroken long words, oversized fixed-height or padded sections, empty blocks on small screens).
    const layoutLeft = () => issues.filter((issue) => String(issue.kind).startsWith('layout-'));
    if (layoutReview && layoutLeft().length) {
      try {
        stageNote('layout_self_heal');
        const cssFile = current.find((file) => file.path === 'src/index.css');
        const GUARD_MARK = '/* veave-layout-guard */';
        if (cssFile && !String(cssFile.content || '').includes(GUARD_MARK)) {
          const guard = `\n${GUARD_MARK}\nhtml, body { max-width: 100%; overflow-x: hidden; }\nimg, video, svg, canvas, iframe { max-width: 100%; }\nh1, h2, h3, h4, p, li, a, span { overflow-wrap: anywhere; }\nsection:empty, div:empty:not([class*="absolute"]):not([aria-hidden]) { display: none; }\n@media (max-width: 767px) {\n  section { min-height: 0 !important; padding-top: min(var(--sec-py, 4rem), 4rem); padding-bottom: min(var(--sec-py, 4rem), 4rem); }\n  section[class*="min-h-screen"], section[class*="h-screen"] { min-height: auto !important; height: auto !important; }\n  [class*="grid-cols-"] { grid-template-columns: minmax(0, 1fr); }\n}\n@media (min-width: 768px) and (max-width: 1023px) { section { min-height: 0 !important; } }\n`;
          const healed = current.map((file) => file === cssFile ? { ...file, content: `${file.content}${guard}` } : file);
          const reviewed = await findAllIssues(healed);
          const beforeCount = layoutLeft().length;
          const afterCount = reviewed.filter((issue) => String(issue.kind).startsWith('layout-')).length;
          const nonLayoutBefore = issues.length - beforeCount;
          const nonLayoutAfter = reviewed.length - afterCount;
          if (afterCount <= beforeCount && nonLayoutAfter <= nonLayoutBefore) { current = healed; issues = reviewed; history.push({ attempt: ++attempts, selfHeal: 'layout-guard', before: beforeCount, after: afterCount }); }
          logger.info(`Layout self-heal: ${beforeCount} defect(s) before, ${afterCount} after the guard stylesheet${current === healed ? ' (kept)' : ' (not better, discarded)'}.`);
        }
      } catch (error) { if (signal?.aborted) throw error; logger.warn(`Layout self-heal skipped: ${error.message}`); }
    }
    // Final pass: whatever the model did, pictures that are saved but still unplaced are placed deterministically (no further searching).
    await recoverImages({ placeOnly: true });
    if (imageContext) stageNote(issues.some((issue) => issue.kind === 'images') ? 'image_failed' : 'completed');
    return {
      files: current,
      layoutSummary: context.layoutSummary || null,
      imageDiagnostic,
      summary: { checked: true, initialIssues: initial, remaining: issues.map(({ kind, message }) => ({ kind, message })), repairAttempts: attempts, complete: issues.length === 0 }
    };
  }
}

module.exports = { ValidationWorker, requiresDockerForVisualReference, isAdvisoryRenderFailure, localizeGeneratedImages, REVIEW_BLOCKING_KINDS };
