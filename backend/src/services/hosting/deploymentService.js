const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const Project = require('../../models/Project');
const PublishedSite = require('../../models/PublishedSite');
const Deployment = require('../../models/Deployment');
const { AppError, NotFoundError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { hostingConfig, siteHost, siteUrl } = require('./config');
const { normalizeSlug, validateSlug, suggestSlug } = require('./slug');
const { buildStaticSite } = require('./buildService');
const storage = require('./storage');
const seoService = require('./seoService');
const { invalidateSite } = require('./staticServer');
const { resolveInside } = require('./safePath');

const LOCK_STALE_MS = 30 * 60 * 1000;
const inFlight = new Map(); // deploymentId -> AbortController

const conflict = (message) => new AppError(message, 409);
const isObjectId = (value) => mongoose.isValidObjectId(value) && String(new mongoose.Types.ObjectId(value)) === String(value);

// Hooks let tests replace the slow / external steps without touching production behaviour.
const defaultDeps = {
  buildStaticSite,
  verifyLive: (...args) => verifyLive(...args),
  verifyPublic: (...args) => verifyPublic(...args)
};

function toPublicSite(site) {
  if (!site) return null;
  return {
    id: String(site._id),
    projectId: String(site.projectId),
    slug: site.slug,
    url: siteUrl(site.slug),
    status: site.status,
    activeVersion: site.activeVersion,
    firstPublishedAt: site.firstPublishedAt,
    lastPublishedAt: site.lastPublishedAt,
    unpublishedAt: site.unpublishedAt
  };
}

function toPublicDeployment(deployment) {
  if (!deployment) return null;
  const doc = deployment.toObject ? deployment.toObject() : deployment;
  return {
    id: doc.deploymentId,
    projectId: String(doc.projectId),
    slug: doc.slug,
    url: siteUrl(doc.slug),
    version: doc.version,
    status: doc.status,
    stage: doc.stage,
    error: doc.error,
    buildMode: doc.buildMode,
    fileCount: doc.fileCount,
    bytes: doc.bytes,
    publicCheck: doc.publicCheck,
    logs: doc.logs || [],
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt
  };
}

async function assertSlugAvailable(slug, { exceptSiteId } = {}) {
  const problem = validateSlug(slug);
  if (problem) throw new ValidationError(problem);
  const existing = await PublishedSite.findOne({ slug }).select('_id').lean();
  if (existing && String(existing._id) !== String(exceptSiteId || '')) throw conflict(`"${slug}" is already taken. Choose a different address.`);
}

async function checkSlug(rawSlug, projectId, userId) {
  const slug = normalizeSlug(rawSlug);
  const problem = validateSlug(slug);
  if (problem) return { slug, available: false, reason: problem, url: null };
  let exceptSiteId = null;
  if (projectId && isObjectId(projectId)) {
    const site = await PublishedSite.findOne({ projectId, userId }).select('_id').lean();
    exceptSiteId = site?._id || null;
  }
  const taken = await PublishedSite.findOne({ slug }).select('_id').lean();
  const available = !taken || String(taken._id) === String(exceptSiteId || '');
  return { slug, available, reason: available ? null : 'That address is already taken.', url: siteUrl(slug) };
}

async function loadOwnedProject(projectId, userId) {
  if (!isObjectId(projectId)) throw new NotFoundError('Project');
  const project = await Project.findOne({ _id: projectId, userId });
  if (project) return project;
  const unowned = await Project.exists({ _id: projectId, $or: [{ userId: null }, { userId: { $exists: false } }] });
  if (unowned) throw new AppError('This project was created without an account, so it cannot be published. Create it again while logged in.', 403);
  throw new NotFoundError('Project');
}

async function getStatus(projectId, userId) {
  await loadOwnedProject(projectId, userId);
  const site = await PublishedSite.findOne({ projectId, userId }).lean();
  const latest = await Deployment.findOne({ projectId, userId }).sort({ createdAt: -1 });
  return { site: toPublicSite(site), deployment: toPublicDeployment(latest), baseDomain: hostingConfig().baseDomain };
}

async function listDeployments(projectId, userId, limit = 10) {
  await loadOwnedProject(projectId, userId);
  const rows = await Deployment.find({ projectId, userId }).sort({ createdAt: -1 }).limit(Math.min(limit, 50));
  return rows.map(toPublicDeployment);
}

async function getDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ deploymentId: String(deploymentId), userId });
  if (!deployment) throw new NotFoundError('Deployment');
  return toPublicDeployment(deployment);
}

async function acquireLock(siteId) {
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const site = await PublishedSite.findOneAndUpdate(
    { _id: siteId, $or: [{ publishingSince: null }, { publishingSince: { $lt: stale } }] },
    { $set: { publishingSince: new Date() } },
    { new: true }
  );
  if (!site) throw conflict('A publish is already in progress for this project.');
  return site;
}

async function startPublish({ projectId, userId, slug: requestedSlug, deps = defaultDeps }) {
  const project = await loadOwnedProject(projectId, userId);
  let site = await PublishedSite.findOne({ projectId: project._id, userId });
  let slug;
  if (requestedSlug) slug = normalizeSlug(requestedSlug);
  else slug = site?.slug || suggestSlug(project.name);

  if (site) {
    if (slug !== site.slug) await assertSlugAvailable(slug, { exceptSiteId: site._id });
    else if (validateSlug(slug)) throw new ValidationError(validateSlug(slug));
  } else {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await assertSlugAvailable(slug);
        site = await PublishedSite.create({ projectId: project._id, userId, slug });
        break;
      } catch (error) {
        const duplicate = error.code === 11000 || (error instanceof AppError && error.statusCode === 409);
        if (!duplicate) throw error;
        if (requestedSlug) throw conflict(`"${slug}" is already taken. Choose a different address.`);
        slug = suggestSlug(project.name); // auto-generated slugs retry with a new suffix
      }
    }
    if (!site) throw conflict('Could not reserve a site address. Try again.');
  }

  site = await acquireLock(site._id);
  const version = `v${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const deployment = await Deployment.create({
    deploymentId: randomBytes(10).toString('hex'),
    siteId: site._id, projectId: project._id, userId, slug, version,
    logs: [{ at: new Date(), level: 'info', message: `Publishing to ${siteHost(slug)}` }]
  });
  const controller = new AbortController();
  inFlight.set(deployment.deploymentId, controller);
  setImmediate(() => {
    runDeployment({ deploymentId: deployment.deploymentId, signal: controller.signal, deps })
      .catch((error) => logger.error(`Deployment ${deployment.deploymentId} crashed: ${error.stack || error.message}`))
      .finally(() => inFlight.delete(deployment.deploymentId));
  });
  return toPublicDeployment(deployment);
}

async function runDeployment({ deploymentId, signal, deps = defaultDeps }) {
  const config = hostingConfig();
  let deployment = await Deployment.findOne({ deploymentId });
  const siteBefore = await PublishedSite.findById(deployment.siteId).lean();
  const wasNeverPublished = !siteBefore.activeVersion && !siteBefore.firstPublishedAt;
  let switched = false;
  let versionWritten = false;

  const log = (message, level = 'info') => Deployment.updateOne(
    { deploymentId },
    { $push: { logs: { $each: [{ at: new Date(), level, message: String(message).slice(0, 2000) }], $slice: -200 } } }
  ).catch(() => {});
  const stage = (name) => Deployment.updateOne({ deploymentId }, { $set: { stage: name } });

  try {
    // 1. Preparing: load exactly the saved source, never regenerate.
    await stage('preparing');
    const project = await Project.findOne({ _id: deployment.projectId, userId: deployment.userId });
    if (!project) throw new NotFoundError('Project');
    const files = await hydrateFiles(project.files || []);
    await log(`Loaded ${files.length} project files.`);

    // 2. Building
    await stage('building');
    const built = await deps.buildStaticSite(files, { projectName: project.name, signal, log: (message) => log(message) });
    await Deployment.updateOne({ deploymentId }, { $set: { buildMode: built.mode } });
    await log(`Build complete (${built.mode}): ${built.files.length} files.`);

    // 2b. Search-engine readiness: sitemap.xml, robots.txt and static HTML for every route. Never blocks a publish.
    try {
      const domainSite = await PublishedSite.findById(siteBefore._id).select('customDomain customDomainStatus').lean();
      const baseUrl = domainSite?.customDomain && domainSite.customDomainStatus === 'verified' ? `https://${domainSite.customDomain}/` : siteUrl(deployment.slug);
      built.files = await seoService.enhanceForSearch(built.files, { baseUrl, sourceFiles: files, log: (message, level) => log(message, level) });
    } catch (seoError) {
      await log(`SEO step skipped: ${seoError.message}`, 'warn');
    }

    // 3. Uploading: write into the artifact store, then sanity-check the candidate before it can go live.
    await stage('uploading');
    signal?.throwIfAborted();
    const written = await storage.writeVersion(siteBefore._id, deployment.version, built.files);
    versionWritten = true;
    await validateCandidate(written.dir);
    await Deployment.updateOne({ deploymentId }, { $set: { fileCount: written.fileCount, bytes: written.bytes } });
    await log(`Stored ${written.fileCount} files (${Math.round(written.bytes / 1024)} KB).`);

    // 4. Publishing: atomic pointer switch (previous version stays on disk for rollback).
    await stage('publishing');
    signal?.throwIfAborted();
    const now = new Date();
    try {
      await PublishedSite.updateOne({ _id: siteBefore._id }, { $set: {
        slug: deployment.slug, status: 'published', activeVersion: deployment.version,
        previousVersion: siteBefore.activeVersion || siteBefore.previousVersion || null,
        activeDeploymentId: deploymentId, lastPublishedAt: now,
        firstPublishedAt: siteBefore.firstPublishedAt || now, unpublishedAt: null
      } });
    } catch (error) {
      if (error.code === 11000) throw conflict(`"${deployment.slug}" was taken by another site while publishing.`);
      throw error;
    }
    switched = true;
    invalidateSite(siteBefore.slug);
    invalidateSite(deployment.slug);

    // 5. Verifying
    await stage('verifying');
    await deps.verifyLive({ slug: deployment.slug, config });
    await log('Live check passed: home page and client-side routes respond.');
    if (config.verifyPublicUrl) {
      const publicCheck = await deps.verifyPublic({ slug: deployment.slug, config });
      await Deployment.updateOne({ deploymentId }, { $set: { publicCheck } });
      await log(publicCheck.ok
        ? `Public URL reachable over ${config.scheme.toUpperCase()}.`
        : `Public URL not reachable yet: ${publicCheck.error}. Check DNS / TLS configuration.`, publicCheck.ok ? 'info' : 'warn');
    }

    // 6. Published
    await Deployment.updateOne({ deploymentId }, { $set: { stage: 'published', status: 'succeeded', finishedAt: new Date(), error: null } });
    await PublishedSite.updateOne({ _id: siteBefore._id }, { $set: { publishingSince: null } });
    const current = await PublishedSite.findById(siteBefore._id).lean();
    await storage.pruneVersions(siteBefore._id, [current.activeVersion, current.previousVersion], config.keepVersions).catch(() => {});
    await log('Published.');
  } catch (error) {
    const message = error?.message || 'Publishing failed.';
    const failedStage = (await Deployment.findOne({ deploymentId }).select('stage').lean())?.stage || 'preparing';
    logger.warn(`Deployment ${deploymentId} failed at ${failedStage}: ${message}`);
    try {
      if (switched) await rollbackSite(siteBefore, deployment.slug);
      if (versionWritten) await storage.removeVersion(siteBefore._id, deployment.version).catch(() => {});
      if (wasNeverPublished) {
        // Release the reserved address so a failed first publish does not squat on it.
        await PublishedSite.deleteOne({ _id: siteBefore._id, activeVersion: null });
        await storage.removeSite(siteBefore._id).catch(() => {});
        invalidateSite(deployment.slug);
      } else {
        await PublishedSite.updateOne({ _id: siteBefore._id }, { $set: { publishingSince: null } });
      }
    } catch (cleanupError) {
      logger.error(`Deployment ${deploymentId} cleanup failed: ${cleanupError.message}`);
    }
    const aborted = error?.name === 'AbortError';
    await Deployment.updateOne({ deploymentId }, { $set: {
      status: 'failed', finishedAt: new Date(),
      error: { stage: failedStage, message: aborted ? 'Publish was cancelled.' : message, details: error?.details ? String(typeof error.details === 'string' ? error.details : JSON.stringify(error.details)).slice(0, 4000) : null,
        previousVersionPreserved: Boolean(siteBefore.activeVersion) }
    }, $push: { logs: { $each: [{ at: new Date(), level: 'error', message: `Failed at ${failedStage}: ${message}` }], $slice: -200 } } });
  }
}

async function rollbackSite(before, attemptedSlug) {
  const hadLive = Boolean(before.activeVersion) && before.status === 'published';
  await PublishedSite.updateOne({ _id: before._id }, { $set: {
    slug: before.slug, status: hadLive ? 'published' : 'unpublished', activeVersion: before.activeVersion || null,
    previousVersion: before.previousVersion || null, activeDeploymentId: before.activeDeploymentId || null,
    lastPublishedAt: before.lastPublishedAt || null, firstPublishedAt: before.firstPublishedAt || null,
    unpublishedAt: before.unpublishedAt || null
  } });
  invalidateSite(before.slug);
  invalidateSite(attemptedSlug);
}

// A candidate must contain a real HTML entry and every local asset it points at.
async function validateCandidate(dir) {
  const indexPath = path.join(dir, 'index.html');
  let html;
  try { html = await fs.readFile(indexPath, 'utf8'); } catch { throw new ValidationError('Build produced no index.html.'); }
  if (!html.trim()) throw new ValidationError('Build produced an empty index.html.');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)[^"']*["']/gi)].map((match) => match[1])
    .filter((ref) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) && /\.[a-z0-9]{2,5}$/i.test(ref));
  for (const ref of refs) {
    const target = resolveInside(dir, ref.replace(/^\.?\//, ''));
    const exists = target && await fs.stat(target).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) throw new ValidationError(`index.html references "${ref}" but the build did not include it.`);
  }
}

function request(url, { headers = {}, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'GET', headers, timeout }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size < 512 * 1024) chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

// Requests the freshly switched site through this server exactly as a visitor's Host header would.
async function verifyLive({ slug, config = hostingConfig() }) {
  const host = siteHost(slug, config) + (config.publicPort ? `:${config.publicPort}` : '');
  const base = config.verifyOrigin.replace(/\/$/, '');
  const home = await request(`${base}/`, { headers: { Host: host, Accept: 'text/html' } }).catch((error) => {
    throw new AppError(`Live check could not reach the server: ${error.message}`, 502);
  });
  if (home.status !== 200 || !/<html|<!doctype/i.test(home.body)) throw new AppError(`Live check failed: home page returned HTTP ${home.status}.`, 502);
  const route = await request(`${base}/__veave_route_check__/nested`, { headers: { Host: host, Accept: 'text/html' } });
  if (route.status !== 200 || !/<html|<!doctype/i.test(route.body)) {
    throw new AppError(`Live check failed: nested routes return HTTP ${route.status} instead of the app (SPA fallback).`, 502);
  }
  return true;
}

async function verifyPublic({ slug, config = hostingConfig() }) {
  try {
    const result = await request(siteUrl(slug, config), { headers: { Accept: 'text/html' }, timeout: 10000 });
    return { ok: result.status === 200, status: result.status, error: result.status === 200 ? null : `HTTP ${result.status}` };
  } catch (error) {
    return { ok: false, status: null, error: error.message };
  }
}

async function unpublish({ projectId, userId }) {
  await loadOwnedProject(projectId, userId);
  const site = await PublishedSite.findOne({ projectId, userId });
  if (!site) throw new NotFoundError('Published site');
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const locked = await PublishedSite.findOneAndUpdate(
    { _id: site._id, $or: [{ publishingSince: null }, { publishingSince: { $lt: stale } }] },
    { $set: { status: 'unpublished', activeVersion: null, previousVersion: null, activeDeploymentId: null, unpublishedAt: new Date() } },
    { new: true }
  );
  if (!locked) throw conflict('A publish is in progress. Try again when it finishes.');
  invalidateSite(site.slug);
  await storage.removeSite(site._id).catch((error) => logger.warn(`Could not remove site files: ${error.message}`));
  return toPublicSite(locked.toObject());
}

// On boot: anything left "running" belonged to a process that died. Fail it and restore the previous version.
async function recoverInterruptedDeployments() {
  const stuck = await Deployment.find({ status: 'running' });
  for (const deployment of stuck) {
    try {
      const site = await PublishedSite.findById(deployment.siteId);
      if (site && site.activeDeploymentId === deployment.deploymentId && ['publishing', 'verifying'].includes(deployment.stage)) {
        await PublishedSite.updateOne({ _id: site._id }, { $set: {
          activeVersion: site.previousVersion || null, status: site.previousVersion ? 'published' : 'unpublished', activeDeploymentId: null } });
      }
      if (site) {
        await PublishedSite.updateOne({ _id: site._id }, { $set: { publishingSince: null } });
        if (!site.activeVersion && !site.firstPublishedAt) await PublishedSite.deleteOne({ _id: site._id });
        await storage.pruneVersions(site._id, [site.activeVersion, site.previousVersion], hostingConfig().keepVersions).catch(() => {});
        invalidateSite(site.slug);
      }
      deployment.status = 'failed';
      deployment.finishedAt = new Date();
      deployment.error = { stage: deployment.stage, message: 'Publishing was interrupted by a server restart. Please publish again.', previousVersionPreserved: true };
      await deployment.save();
    } catch (error) {
      logger.warn(`Could not recover deployment ${deployment.deploymentId}: ${error.message}`);
    }
  }
  return stuck.length;
}

module.exports = {
  startPublish, runDeployment, loadOwnedProject, unpublish, getStatus, getDeployment, listDeployments, checkSlug,
  recoverInterruptedDeployments, validateCandidate, verifyLive, toPublicSite, toPublicDeployment, defaultDeps
};
