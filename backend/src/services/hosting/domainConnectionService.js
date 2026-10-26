// API-level operations for connecting a custom domain: validate, start/retry/inspect the durable workflow, disconnect.
// The long-running work lives in domainOrchestrator; everything here is quick and re-checks authorisation on every call.
const DomainConnection = require('../../models/DomainConnection');
const DomainOrder = require('../../models/DomainOrder');
const PublishedSite = require('../../models/PublishedSite');
const Project = require('../../models/Project');
const { AppError, NotFoundError, ValidationError } = require('../../utils/errors');
const { hostingConfig, domainConfig } = require('./config');
const { normalizeHostname, classifyHostname, servedHostnames } = require('./domainValidation');
const verification = require('./domainVerification');
const planner = require('./dnsPlanner');
const orchestrator = require('./domainOrchestrator');
const godaddy = require('./godaddyService');
const { invalidateSite } = require('./staticServer');

const conflict = (message) => new AppError(message, 409);

// Starts a worker pass immediately so the user sees progress without waiting for the next scheduler tick. Tests (and
// operators who want only the scheduler) can switch it off; the durable loop does the same work either way.
const kick = (connectionId, deps) => (process.env.DOMAIN_ORCHESTRATOR_AUTORUN === 'false'
  ? Promise.resolve(null) : orchestrator.runNow(connectionId, deps || {}).catch(() => null));
const LIVE = { live: true };

const STEPS = [
  { key: 'validating_request', label: 'Validating domain' },
  { key: 'pending_verification', label: 'Verifying ownership' },
  { key: 'configuring_dns', label: 'Configuring DNS' },
  { key: 'deploying', label: 'Publishing website' },
  { key: 'configuring_routing', label: 'Routing your domain' },
  { key: 'ssl_pending', label: 'Configuring HTTPS' },
  { key: 'checking_health', label: 'Checking website availability' }
];
// Where each stage sits in the user-facing step list.
const STEP_OF = { validating_request: 0, pending_verification: 1, verified: 1, configuring_dns: 2, dns_pending: 2, deploying: 3, configuring_routing: 4, ssl_pending: 5, checking_health: 6, active: 7 };

function progressSteps(connection) {
  const current = connection.stage === 'failed' ? STEP_OF[connection.failure?.stage] ?? 0 : STEP_OF[connection.stage] ?? 0;
  return STEPS.map((step, index) => ({
    key: step.key, label: step.label,
    state: connection.stage === 'active' || index < current ? 'done'
      : index === current ? (connection.stage === 'failed' ? 'failed' : connection.status === 'action_required' ? 'action_required' : 'running') : 'pending'
  }));
}

function headline(connection) {
  if (connection.stage === 'active') return connection.health.ok === false && connection.health.checkedAt ? 'Published, but a recent check found a problem' : 'Website published successfully';
  if (connection.stage === 'failed') return 'Publishing failed';
  if (connection.status === 'action_required') return 'Action required';
  return {
    validating_request: 'Validating domain', pending_verification: 'Verifying ownership', verified: 'Ownership verified', configuring_dns: 'Configuring DNS',
    dns_pending: 'Waiting for DNS to update', deploying: 'Publishing website', configuring_routing: 'Routing your domain', ssl_pending: 'Configuring HTTPS', checking_health: 'Checking website availability'
  }[connection.stage] || 'Working';
}

// What the browser may see: no tokens, secrets, internal addresses or stack traces.
function publicView(connection) {
  if (!connection) return { domain: null };
  const doc = connection.toObject ? connection.toObject() : connection;
  const view = {
    id: String(doc._id), domain: doc.hostname, hostname: doc.hostname, apex: doc.apex, kind: doc.kind, includeWww: doc.includeWww, canonical: doc.canonical,
    hostnames: doc.hostnames, stage: doc.stage, state: doc.status, headline: headline(doc), steps: progressSteps(doc),
    url: doc.stage === 'active' || doc.ssl?.status === 'active' ? `https://${(doc.canonical === 'www' && doc.includeWww ? `www.${doc.apex}` : doc.kind === 'apex' ? doc.apex : doc.hostname)}/` : null,
    action: doc.actionRequired ? { type: doc.actionRequired.type, message: doc.actionRequired.message, records: doc.actionRequired.records || [], conflicts: doc.actionRequired.conflicts || [], observed: doc.actionRequired.observed || null } : null,
    verification: { method: doc.verification?.method, expiresAt: doc.verification?.expiresAt, verifiedAt: doc.verification?.verifiedAt, attempts: doc.verification?.attempts },
    dns: { provider: doc.dns?.provider, mode: doc.dns?.mode, checks: (doc.dns?.checks || []).map(({ hostname, ok, problem }) => ({ hostname, ok, problem })), conflicts: doc.dns?.conflicts || null, appliedAt: doc.dns?.appliedAt, resolvedAt: doc.dns?.resolvedAt },
    ssl: { status: doc.ssl?.status, issuer: doc.ssl?.issuer, expiresAt: doc.ssl?.expiresAt, error: doc.ssl?.error },
    health: { ok: Boolean(doc.health?.ok), checkedAt: doc.health?.checkedAt, lastSuccessAt: doc.health?.lastSuccessAt, problems: doc.health?.checks?.failures || [] },
    failure: doc.failure ? { stage: doc.failure.stage, message: doc.failure.message, recoverable: doc.failure.recoverable } : null,
    lastError: doc.lastError || null,
    history: (doc.history || []).slice(-25).map(({ at, stage, level, message }) => ({ at, stage, level, message })),
    updatedAt: doc.updatedAt,
    // Fields the earlier domain panel relied on.
    status: doc.stage === 'active' ? 'verified' : 'pending',
    verifiedAt: doc.verification?.verifiedAt || null,
    lastCheckError: doc.lastError || null,
    records: doc.actionRequired?.records || [],
    goDaddyAvailable: godaddy.isEnabled()
  };
  return view;
}

async function ownedProject(projectId, userId) {
  return require('./deploymentService').loadOwnedProject(projectId, userId);
}

async function currentConnection(projectId) {
  return DomainConnection.findOne({ projectId, ...LIVE });
}

/** Cheap preflight for the UI: is this hostname acceptable, who runs its DNS, and is it free to claim? */
async function check(userId, hostnameInput, { providers = require('./dnsProviders') } = {}) {
  const parsed = normalizeHostname(hostnameInput);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  const target = classifyHostname(parsed.hostname);
  const taken = await DomainConnection.findOne({ hostnames: target.hostname, claimed: true, live: true }).select('userId').lean();
  const provider = await providers.detectProvider(target.apex).catch(() => ({ id: 'unknown', label: 'your DNS provider', found: false }));
  const access = await providers.resolveAdapter(target.apex, { provider }).catch(() => ({ authorized: false }));
  return {
    hostname: target.hostname, apex: target.apex, kind: target.kind,
    available: !taken, connectedToYou: Boolean(taken && String(taken.userId) === String(userId)),
    reason: taken ? 'This domain is already connected to a project.' : null,
    dns: { provider: provider.id, providerLabel: provider.label, automatic: Boolean(access.authorized) }
  };
}

async function isPurchasedBy(userId, apex) {
  return Boolean(await DomainOrder.exists({ userId, domain: apex, kind: 'registration', status: 'registered' }));
}

/**
 * Start (or update) the connection for a project. Idempotent: asking again for the same hostname returns the running one.
 * `move` lets the same user transfer a verified domain from another of their own projects.
 */
/** Everything that can reject a domain request, with no side effects (used to fail BEFORE a publish is started). */
async function assertConnectable({ projectId, userId, hostname: input, move = false }) {
  await ownedProject(projectId, userId);
  const parsed = normalizeHostname(input);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  const target = classifyHostname(parsed.hostname);
  const hostnames = servedHostnames(target, { includeWww: true });
  const holder = await DomainConnection.findOne({ hostnames: { $in: hostnames }, claimed: true, live: true, projectId: { $ne: projectId } }).select('userId').lean();
  if (holder && (String(holder.userId) !== String(userId) || !move)) {
    throw conflict(String(holder.userId) !== String(userId)
      ? 'That domain is already connected to another project. If it is yours, disconnect it from the other account first.'
      : 'That domain is connected to another one of your projects. Disconnect it there, or confirm the move.');
  }
  return target;
}

async function connect({ projectId, userId, hostname: input, includeWww = true, canonical = 'none', confirmReplace = false, move = false, deps = null }) {
  await ownedProject(projectId, userId);
  const parsed = normalizeHostname(input);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  const target = classifyHostname(parsed.hostname);
  if (!['none', 'apex', 'www'].includes(canonical)) throw new ValidationError('Invalid canonical host choice.');
  const wantWww = target.kind === 'apex' ? Boolean(includeWww || target.typedWww) : false;
  const hostnames = servedHostnames(target, { includeWww: wantWww });
  const effectiveCanonical = target.kind === 'apex' && wantWww ? canonical : 'none';

  const site = await PublishedSite.findOne({ projectId, userId });
  if (!site) throw new ValidationError('Publish the project first, then connect a domain.');

  // Another project already holds a VERIFIED claim on any of these hostnames.
  const holder = await DomainConnection.findOne({ hostnames: { $in: hostnames }, claimed: true, live: true, projectId: { $ne: projectId } }).select('userId projectId hostname').lean();
  if (holder) {
    if (String(holder.userId) !== String(userId)) throw conflict('That domain is already connected to another project. If it is yours, disconnect it from the other account first.');
    if (!move) throw conflict('That domain is connected to another one of your projects. Disconnect it there, or confirm the move.');
    await disconnect({ projectId: holder.projectId, userId });
  }

  const existing = await currentConnection(projectId);
  if (existing) {
    if (existing.hostname === target.hostname) {
      existing.includeWww = wantWww; existing.canonical = effectiveCanonical; existing.hostnames = hostnames;
      if (confirmReplace) existing.dns.confirmReplace = true;
      if (existing.status !== 'removed' && existing.stage !== 'failed') { existing.nextRunAt = new Date(); await existing.save(); kick(existing._id, deps); return publicView(await DomainConnection.findById(existing._id)); }
      await existing.save();
      return retry({ projectId, userId, deps });
    }
    await disconnect({ projectId, userId });
  }

  const purchased = await isPurchasedBy(userId, target.apex);
  const connection = new DomainConnection({
    userId, projectId, siteId: site._id, hostname: target.hostname, apex: target.apex, kind: target.kind,
    includeWww: wantWww, canonical: effectiveCanonical, hostnames,
    verification: { method: purchased ? 'purchase-order' : 'dns-txt', nonce: verification.newNonce(), expiresAt: new Date(Date.now() + domainConfig().verifyTtlMs) },
    dns: { confirmReplace: Boolean(confirmReplace) },
    history: [{ at: new Date(), stage: 'validating_request', level: 'info', message: `Connecting ${target.hostname}` }]
  });
  try { await connection.save(); }
  catch (error) {
    if (error.code === 11000) { const raced = await currentConnection(projectId); if (raced) return publicView(raced); }
    throw error;
  }
  kick(connection._id, deps);
  return publicView(await DomainConnection.findById(connection._id));
}

async function status(projectId, userId) {
  await ownedProject(projectId, userId);
  return publicView(await currentConnection(projectId));
}

/** "Check again": reset the wait and run the workflow now. */
async function verifyNow({ projectId, userId, deps = null }) {
  await ownedProject(projectId, userId);
  const connection = await currentConnection(projectId);
  if (!connection) throw new ValidationError('No domain is connected to this project.');
  if (connection.stage === 'failed') return retry({ projectId, userId, deps });
  await DomainConnection.updateOne({ _id: connection._id }, { $set: { nextRunAt: new Date(), retries: 0 } });
  await kick(connection._id, deps);
  return publicView(await DomainConnection.findById(connection._id));
}

/** Resume a failed (recoverable) workflow from the stage that failed, with a fresh challenge if it had expired. */
async function retry({ projectId, userId, deps = null }) {
  await ownedProject(projectId, userId);
  const connection = await currentConnection(projectId);
  if (!connection) throw new ValidationError('No domain is connected to this project.');
  if (connection.stage !== 'failed') return verifyNow({ projectId, userId, deps });
  if (connection.failure && connection.failure.recoverable === false) throw conflict(connection.failure.message || 'This connection cannot be retried. Disconnect it and start again.');
  const failedAt = connection.failure?.stage && connection.failure.stage !== 'failed' ? connection.failure.stage : 'pending_verification';
  const resumeAt = ['validating_request', 'pending_verification'].includes(failedAt) ? 'pending_verification' : failedAt;
  if (resumeAt === 'pending_verification' || (connection.verification.expiresAt && connection.verification.expiresAt < new Date())) {
    connection.verification.nonce = verification.newNonce();
    connection.verification.expiresAt = new Date(Date.now() + domainConfig().verifyTtlMs);
    connection.verification.attempts = 0;
    connection.dns.txtWritten = false;
  }
  connection.stage = resumeAt;
  connection.status = 'in_progress'; connection.retries = 0; connection.failure = null; connection.lastError = null; connection.actionRequired = null;
  connection.nextRunAt = new Date();
  connection.history.push({ at: new Date(), stage: connection.stage, level: 'info', message: 'Retrying' });
  await connection.save();
  kick(connection._id, deps);
  return publicView(await DomainConnection.findById(connection._id));
}

/** The user agrees that existing A/AAAA/CNAME records for the connected names may be replaced. */
async function confirmReplace({ projectId, userId, deps = null }) {
  await ownedProject(projectId, userId);
  const connection = await currentConnection(projectId);
  if (!connection) throw new ValidationError('No domain is connected to this project.');
  connection.dns.confirmReplace = true;
  connection.nextRunAt = new Date();
  await connection.save();
  await kick(connection._id, deps);
  return publicView(await DomainConnection.findById(connection._id));
}

function instructions(view) {
  return { stage: view.stage, records: view.action?.records || [], message: view.action?.message || null };
}

async function health({ projectId, userId, refresh = false, deps = null }) {
  await ownedProject(projectId, userId);
  const connection = await currentConnection(projectId);
  if (!connection) throw new ValidationError('No domain is connected to this project.');
  const fresh = connection.health.checkedAt && Date.now() - new Date(connection.health.checkedAt).getTime() < 30000;
  if (refresh && !fresh && ['active', 'checking_health'].includes(connection.stage)) {
    const result = await orchestrator.runHealth(connection, { ...orchestrator.defaultDeps(), ...(deps || {}) });
    connection.health.ok = result.ok; connection.health.checkedAt = new Date(); if (result.ok) connection.health.lastSuccessAt = new Date();
    connection.health.checks = { failures: result.failures, hosts: result.checks };
    connection.markModified('health');
    await connection.save();
  }
  return { ...publicView(connection), checks: connection.health.checks?.hosts || [] };
}

/**
 * Disconnect: stop serving the domain and release the exclusive claim. DNS records and the deployed site are left alone
 * (a customer's records are never deleted automatically); only the ownership TXT Veave itself published is removed.
 */
async function disconnect({ projectId, userId, deps = null }) {
  await ownedProject(projectId, userId);
  const connection = await currentConnection(projectId);
  if (!connection) return { domain: null };
  await orchestrator.releaseRouting(connection).catch(() => {});
  if (connection.dns.txtWritten) {
    try {
      const providers = deps?.providers || require('./dnsProviders');
      const access = await providers.resolveAdapter(connection.apex, { provider: { id: connection.dns.provider, found: true, label: connection.dns.provider }, adapters: deps?.adapters || null });
      const record = verification.challengeRecord(connection);
      if (access.adapter) await access.adapter.deleteRecord(connection.apex, { type: 'TXT', name: record.name });
    } catch { /* leaving a harmless TXT record behind is better than failing the disconnect */ }
  }
  connection.live = false; connection.claimed = false; connection.status = 'removed'; connection.removedAt = new Date(); connection.nextRunAt = null; connection.leaseUntil = null;
  connection.history.push({ at: new Date(), stage: connection.stage, level: 'info', message: 'Disconnected' });
  await connection.save();
  for (const host of connection.hostnames) invalidateSite(null, host);
  return { domain: null };
}

/** The workflow's question from Caddy's on-demand TLS: may a certificate be issued for this exact host? */
async function isIssuableHostname(input) {
  const parsed = normalizeHostname(input);
  if (!parsed.ok) return false;
  const connection = await DomainConnection.findOne({
    hostnames: parsed.hostname, claimed: true, live: true, 'routing.activatedAt': { $ne: null }, stage: { $in: ['ssl_pending', 'checking_health', 'active'] }
  }).select('siteId').lean();
  if (!connection) return false;
  return Boolean(await PublishedSite.exists({ _id: connection.siteId, status: 'published' }));
}

module.exports = { connect, assertConnectable, status, verifyNow, retry, confirmReplace, disconnect, health, check, instructions, publicView, isIssuableHostname, progressSteps, STEPS };
