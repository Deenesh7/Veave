// The durable engine that carries a DomainConnection from "user typed a domain" to "the site is live over HTTPS and was
// checked from the outside". It is a state machine over the `stage` stored on the connection:
//
//   validating_request -> pending_verification -> verified -> configuring_dns -> dns_pending -> deploying
//     -> configuring_routing -> ssl_pending -> checking_health -> active          (failed from any stage; resumable)
//
// Design rules
//  * Every step is idempotent and re-reads real state (DNS, deployments, certificates) instead of trusting what it did last
//    time, so a crash, restart or duplicate worker can only repeat work, never corrupt it.
//  * A worker holds a short lease on a connection; the loop is driven by `nextRunAt`, so it survives restarts by design.
//  * "Waiting" is a normal result: DNS propagation, certificate issuance and deployments reschedule themselves with
//    exponential backoff and bounded attempts. Only a definite problem becomes `failed`.
//  * Nothing is reported active until probes from the outside (public DNS, HTTP, TLS, page content) agree.
const fs = require('node:fs/promises');
const path = require('node:path');
const DomainConnection = require('../../models/DomainConnection');
const PublishedSite = require('../../models/PublishedSite');
const Deployment = require('../../models/Deployment');
const logger = require('../../utils/logger');
const { hostingConfig, domainConfig, siteHost } = require('./config');
const verification = require('./domainVerification');
const providers = require('./dnsProviders');
const planner = require('./dnsPlanner');
const liveProbes = require('./liveProbes');
const storage = require('./storage');
const { invalidateSite } = require('./staticServer');

const MAX_HISTORY = 100;
const STEP_LOOPS = 14; // stages one worker pass may chain (keeps a fresh connection moving without waiting a tick)

const defaultDeps = () => ({
  now: () => new Date(),
  random: Math.random,
  probes: liveProbes.defaultProbes,
  verification,
  providers,
  adapters: null, // tests inject fake DNS providers; production uses the GoDaddy adapter
  startPublish: (args) => require('./deploymentService').startPublish(args),
  readActiveIndex: async (site) => {
    const html = await fs.readFile(path.join(storage.versionDir(site._id, site.activeVersion), 'index.html'));
    return { html, hash: liveProbes.bodyHash(html) };
  }
});

// ---- small state helpers ---------------------------------------------------------------------------------------------
function note(connection, message, level = 'info') {
  connection.history.push({ at: new Date(), stage: connection.stage, level, message: String(message).slice(0, 500) });
  if (connection.history.length > MAX_HISTORY) connection.history.splice(0, connection.history.length - MAX_HISTORY);
}

const jitter = (deps, ms) => Math.round(ms * (0.85 + deps.random() * 0.3));
const backoff = (deps, retries, base, max) => jitter(deps, Math.min(max, base * 2 ** Math.min(retries, 12)));

function moveTo(connection, stage, deps) {
  connection.stage = stage;
  connection.status = 'in_progress';
  connection.actionRequired = null;
  connection.retries = 0;
  connection.lastError = null;
  connection.nextRunAt = deps.now();
  note(connection, `Stage: ${stage}`);
}

function waitFor(connection, ms, deps, { message = null, status = 'in_progress', action = null } = {}) {
  connection.retries += 1;
  connection.status = status;
  connection.actionRequired = action;
  if (message) connection.lastError = message;
  connection.nextRunAt = new Date(deps.now().getTime() + ms);
}

function fail(connection, message, deps, { recoverable = true } = {}) {
  connection.failure = { stage: connection.stage === 'failed' ? connection.failure?.stage : connection.stage, message: String(message).slice(0, 500), recoverable, at: deps.now() };
  note(connection, `Failed: ${message}`, 'error');
  connection.stage = 'failed';
  connection.status = 'failed';
  connection.actionRequired = null;
  connection.lastError = String(message).slice(0, 500);
  connection.nextRunAt = null;
  connection.leaseUntil = null;
}

async function loadSite(connection) {
  return connection.siteId ? PublishedSite.findById(connection.siteId) : PublishedSite.findOne({ projectId: connection.projectId });
}

async function endpoint(connection, site, deps) {
  const config = domainConfig();
  return { ipv4: config.ipv4, ipv6: config.ipv6, cnameTarget: siteHost(site.slug) };
}

// The addresses visitors must be sent to: the configured ingress, or (development) wherever the platform host resolves.
async function expectedAddresses(connection, site, deps) {
  const config = domainConfig();
  if (config.ipv4) return [config.ipv4];
  const target = await deps.probes.resolveAll(siteHost(site.slug));
  return target.a;
}

async function dnsPointsHere(hostname, expected, deps) {
  const resolved = await deps.probes.resolveAll(hostname);
  const config = domainConfig();
  const staleV6 = resolved.aaaa.filter((ip) => !config.ipv6 || ip !== config.ipv6);
  const wrongV4 = resolved.a.filter((ip) => !expected.includes(ip));
  const ok = resolved.a.length > 0 && wrongV4.length === 0 && staleV6.length === 0 && expected.length > 0;
  return { hostname, ok, a: resolved.a, aaaa: resolved.aaaa, cname: resolved.cname, transient: resolved.transientErrors.length > 0 && resolved.a.length === 0,
    problem: ok ? null : resolved.a.length === 0
      ? `${hostname} does not resolve yet.`
      : wrongV4.length ? `${hostname} still points to ${wrongV4.join(', ')} instead of ${expected.join(', ')}.`
      : `${hostname} has an IPv6 (AAAA) record (${staleV6.join(', ')}) that does not belong to Veave.` };
}

// ---- stage handlers --------------------------------------------------------------------------------------------------
const handlers = {
  async validating_request(c, deps) {
    moveTo(c, 'pending_verification', deps);
  },

  async pending_verification(c, deps) {
    const cfg = domainConfig();
    if (c.verification.method === 'purchase-order') { moveTo(c, 'verified', deps); return; }
    if (c.verification.expiresAt && deps.now() > c.verification.expiresAt) {
      fail(c, 'The verification request expired before the DNS record was found. Start verification again to get a fresh record.', deps);
      return;
    }
    const site = await loadSite(c);
    if (!site) { fail(c, 'The project is no longer published.', deps, { recoverable: false }); return; }
    const record = deps.verification.challengeRecord(c);
    const target = await endpoint(c, site, deps);

    // Who runs this domain's DNS, and can Veave change it?
    if (!c.dns.provider || c.dns.authorized === false && c.retries === 0) {
      const provider = await deps.providers.detectProvider(c.apex).catch(() => ({ id: 'unknown', label: 'your DNS provider', found: false }));
      const access = await deps.providers.resolveAdapter(c.apex, { provider, adapters: deps.adapters });
      if (access.transient) { waitFor(c, backoff(deps, c.retries, 10000, 120000), deps, { message: access.reason }); return; }
      c.dns.provider = provider.id;
      c.dns.authorized = access.authorized;
      c.dns.mode = access.authorized ? 'automatic' : 'manual';
      note(c, access.authorized ? `DNS for ${c.apex} is managed at ${provider.label}; Veave can configure it.` : `DNS for ${c.apex} is managed at ${provider.label}; manual setup. ${access.reason || ''}`);
      c.markModified('dns');
    }
    // With authority, Veave publishes the challenge itself (only that one record).
    if (c.dns.authorized && !c.dns.txtWritten) {
      const access = await deps.providers.resolveAdapter(c.apex, { provider: { id: c.dns.provider, found: true, label: c.dns.provider }, adapters: deps.adapters });
      if (!access.adapter) { c.dns.authorized = false; c.dns.mode = 'manual'; c.markModified('dns'); waitFor(c, 5000, deps, { message: access.reason }); return; }
      await access.adapter.setRecord(c.apex, { type: 'TXT', name: record.name, data: record.data, ttl: 600 });
      c.dns.txtWritten = true;
      c.markModified('dns');
      note(c, `Wrote the ownership TXT record ${record.name}.`);
    }

    c.verification.attempts += 1;
    c.verification.lastCheckedAt = deps.now();
    const result = await deps.verification.checkChallenge(c, { resolvers: deps.resolvers });
    if (result.verified) { c.verification.verifiedAt = deps.now(); note(c, `Ownership verified via DNS TXT (${result.via || 'public resolver'}).`); moveTo(c, 'verified', deps); return; }

    if (c.dns.authorized) {
      waitFor(c, backoff(deps, c.retries, 15000, 5 * 60 * 1000), deps, { message: `${result.reason} Waiting for DNS to propagate.` });
    } else {
      const instructions = planner.manualInstructions(c, target, record);
      waitFor(c, 60000, deps, { status: 'action_required', message: result.reason, action: {
        type: 'add-dns-records', message: `Add these records at ${c.dns.provider && c.dns.provider !== 'unknown' ? c.dns.provider : 'your DNS provider'}. Ownership is verified automatically as soon as the TXT record is visible.`, records: instructions } });
    }
  },

  async verified(c, deps) {
    // Exclusive claim: a hostname can be verified for one project at a time. The unique partial index decides races.
    try {
      const claimed = await DomainConnection.findOneAndUpdate({ _id: c._id, claimed: false }, { $set: { claimed: true } }, { new: true });
      if (!claimed) {
        const current = await DomainConnection.findById(c._id).select('claimed').lean(); // already ours (a retried step)
        if (!current?.claimed) throw Object.assign(new Error('lost claim'), { code: 'LOST' });
      }
      c.claimed = true;
    } catch (error) {
      if (error.code === 11000 || error.code === 'LOST') { fail(c, 'This domain is already connected to another project. Disconnect it there first.', deps, { recoverable: false }); return; }
      throw error;
    }
    moveTo(c, 'configuring_dns', deps);
  },

  async configuring_dns(c, deps) {
    const site = await loadSite(c);
    if (!site) { fail(c, 'The project is no longer published.', deps, { recoverable: false }); return; }
    const target = await endpoint(c, site, deps);
    const provider = { id: c.dns.provider || 'unknown', found: Boolean(c.dns.provider && c.dns.provider !== 'unknown'), label: c.dns.provider || 'your DNS provider' };
    const access = await deps.providers.resolveAdapter(c.apex, { provider, adapters: deps.adapters });
    if (access.transient) { waitFor(c, backoff(deps, c.retries, 10000, 120000), deps, { message: access.reason }); return; }

    if (!access.adapter) {
      const records = planner.manualInstructions(c, target, null);
      const plan = planner.planDnsChanges(c, [], target, {});
      if (plan.error) { fail(c, plan.error, deps, { recoverable: true }); return; }
      c.dns.authorized = false; c.dns.mode = 'manual';
      c.markModified('dns');
      note(c, 'DNS must be changed by the domain owner; instructions are shown.');
      c.stage = 'dns_pending'; c.retries = 0; c.nextRunAt = deps.now(); c.status = 'action_required';
      c.actionRequired = { type: 'add-dns-records', message: 'Add these DNS records. Veave detects them automatically.', records };
      return;
    }

    // Read first, change only what is needed, then read again to prove it.
    const existing = await access.adapter.listRecords(c.apex);
    const relevant = existing.map(planner.normalizeRecord);
    const plan = planner.planDnsChanges(c, relevant, target, { confirmReplace: c.dns.confirmReplace });
    c.dns.plan = { actions: plan.actions.map(({ op, type, name, data, reason }) => ({ op, type, name, data, reason })), satisfied: plan.satisfied.length };
    c.dns.conflicts = plan.conflicts.map(({ code, name, type, message, blocking, records }) => ({ code, name, type, message, blocking, records: (records || []).map((r) => ({ type: r.type, name: r.name, data: r.data })) }));
    c.markModified('dns');
    if (plan.error) { fail(c, plan.error, deps); return; }
    if (plan.manual) {
      c.stage = 'configuring_dns';
      waitFor(c, 5 * 60 * 1000, deps, { status: 'action_required', message: plan.conflicts.find((x) => x.blocking)?.message, action: {
        type: 'dns-conflict', message: 'Some existing DNS records cannot be changed automatically. Resolve them at your DNS provider; Veave will continue on its own.', conflicts: c.dns.conflicts, records: planner.manualInstructions(c, target, null) } });
      return;
    }
    if (plan.blocked) {
      waitFor(c, 5 * 60 * 1000, deps, { status: 'action_required', message: 'Existing DNS records would be replaced; confirmation is required.', action: {
        type: 'confirm-replace', message: 'Connecting this domain replaces the records below. Confirm to continue, or keep them and use a subdomain.', conflicts: c.dns.conflicts, plan: c.dns.plan.actions } });
      return;
    }
    for (const action of plan.actions) {
      if (action.op === 'delete') await access.adapter.deleteRecord(c.apex, { type: action.type, name: action.name });
      else await access.adapter.setRecord(c.apex, { type: action.type, name: action.name, data: action.data, ttl: action.ttl || 600 });
      note(c, `DNS ${action.op} ${action.type} ${action.name}${action.data ? ` -> ${action.data}` : ''}`);
    }
    // Verify what the provider now holds.
    const after = (await access.adapter.listRecords(c.apex)).map(planner.normalizeRecord);
    const recheck = planner.planDnsChanges(c, after, target, { confirmReplace: true });
    const outstanding = recheck.actions.filter((action) => action.op === 'set');
    if (outstanding.length) { waitFor(c, backoff(deps, c.retries, 10000, 120000), deps, { message: `The DNS provider has not applied ${outstanding.map((a) => `${a.type} ${a.name}`).join(', ')} yet.` }); if (c.retries > 6) fail(c, 'The DNS provider did not apply the records.', deps); return; }
    c.dns.appliedAt = deps.now();
    c.markModified('dns');
    note(c, 'DNS records are configured at the provider.');
    moveTo(c, 'dns_pending', deps);
    c.nextRunAt = new Date(deps.now().getTime() + 5000);
  },

  async dns_pending(c, deps) {
    const cfg = domainConfig();
    const site = await loadSite(c);
    if (!site) { fail(c, 'The project is no longer published.', deps, { recoverable: false }); return; }
    const expected = await expectedAddresses(c, site, deps);
    if (!expected.length) { fail(c, 'The hosting endpoint address is not configured, so DNS cannot be checked.', deps); return; }
    const checks = await Promise.all(c.hostnames.map((hostname) => dnsPointsHere(hostname, expected, deps)));
    c.dns.checks = checks.map(({ hostname, ok, a, cname, problem }) => ({ hostname, ok, a, cname, problem }));
    c.markModified('dns');
    if (checks.every((check) => check.ok)) { c.dns.resolvedAt = deps.now(); c.markModified('dns'); note(c, `DNS points ${c.hostnames.join(', ')} at Veave.`); moveTo(c, 'deploying', deps); return; }
    const startedAt = c.dns.appliedAt || c.createdAt;
    if (deps.now() - new Date(startedAt) > cfg.dnsWaitMs) {
      fail(c, `DNS did not point at Veave within ${Math.round(cfg.dnsWaitMs / 3600000)} hours. ${checks.filter((x) => !x.ok).map((x) => x.problem).join(' ')}`, deps);
      return;
    }
    const problems = checks.filter((check) => !check.ok).map((check) => check.problem);
    if (c.dns.authorized) waitFor(c, backoff(deps, c.retries, 20000, 10 * 60 * 1000), deps, { message: problems.join(' ') });
    else {
      const records = planner.manualInstructions(c, await endpoint(c, site, deps), null);
      waitFor(c, 60000, deps, { status: 'action_required', message: problems.join(' '), action: { type: 'add-dns-records', message: 'Waiting for these DNS records. Veave checks automatically.', records, observed: c.dns.checks } });
    }
  },

  async deploying(c, deps) {
    const cfg = domainConfig();
    const site = await loadSite(c);
    if (!site) { fail(c, 'The project is no longer published.', deps, { recoverable: false }); return; }
    c.siteId = site._id;
    const live = site.status === 'published' && site.activeVersion;
    const running = await Deployment.findOne({ siteId: site._id, status: 'running' }).select('deploymentId').lean();
    if (running) {
      c.deployment.deploymentId = running.deploymentId;
      c.deployment.waitingSince = c.deployment.waitingSince || deps.now();
      waitFor(c, 5000, deps, { message: 'Waiting for the website build to finish.' });
      if (deps.now() - c.deployment.waitingSince > cfg.deployWaitMs) fail(c, 'The website build is taking too long.', deps);
      return;
    }
    if (!live) {
      const last = await Deployment.findOne({ siteId: site._id }).sort({ createdAt: -1 }).lean();
      if (last?.status === 'failed' && c.deployment.deploymentId === last.deploymentId) { fail(c, `Publishing the website failed: ${last.error?.message || 'unknown error'}. Fix the problem and retry.`, deps); return; }
      if (c.retries < 3) {
        const deployment = await deps.startPublish({ projectId: c.projectId, userId: c.userId });
        c.deployment.deploymentId = deployment.id;
        note(c, 'Started publishing the website.');
        waitFor(c, 5000, deps);
        return;
      }
      fail(c, 'The website is not published.', deps);
      return;
    }
    // A published build must really exist on disk before a domain is pointed at it.
    let index;
    try { index = await deps.readActiveIndex(site); } catch { fail(c, 'The published website files are missing; publish the site again.', deps); return; }
    if (!index.html.length) { fail(c, 'The published website has an empty home page.', deps); return; }
    c.deployment.deploymentId = site.activeDeploymentId;
    c.deployment.version = site.activeVersion;
    c.deployment.readyAt = deps.now();
    c.markModified('deployment');
    moveTo(c, 'configuring_routing', deps);
  },

  async configuring_routing(c, deps) {
    const site = await loadSite(c);
    if (!site || site.status !== 'published') { c.stage = 'deploying'; c.nextRunAt = deps.now(); return; }
    const primary = c.kind === 'subdomain' ? c.hostname : c.apex;
    // A stale, never-verified legacy claim must not block a verified owner; a verified claim of someone else must.
    const holder = await PublishedSite.findOne({ customDomain: primary, _id: { $ne: site._id } }).select('customDomainStatus').lean();
    if (holder) {
      if (holder.customDomainStatus === 'verified') { fail(c, 'This domain is already connected to another project.', deps, { recoverable: false }); return; }
      await PublishedSite.updateOne({ _id: holder._id }, { $unset: { customDomain: 1 }, $set: { customDomainStatus: 'none', customDomainToken: '' } });
    }
    await PublishedSite.updateOne({ _id: site._id }, { $set: {
      customDomain: primary, customDomainStatus: 'verified', customDomainVerifiedAt: c.verification.verifiedAt || deps.now(), customDomainError: '',
      customDomainWww: c.hostnames.length > 1 || c.kind === 'subdomain' ? c.includeWww : false, customDomainCanonical: c.canonical === 'none' ? '' : c.canonical } });
    invalidateSite(site.slug, primary);
    for (const hostname of c.hostnames) invalidateSite(null, hostname);
    // The routing layer must answer for every hostname with exactly this site's files.
    const index = await deps.readActiveIndex(site);
    for (const hostname of c.hostnames) {
      const response = await deps.probes.request({ protocol: 'http:', ip: originHost(), port: originPort(), hostname, path: '/' }).catch((error) => ({ error: error.message }));
      if (response.error || response.status !== 200 || response.hash !== index.hash) {
        waitFor(c, backoff(deps, c.retries, 3000, 60000), deps, { message: `Routing check failed for ${hostname}: ${response.error || `HTTP ${response.status}, content did not match the published site`}` });
        if (c.retries > 8) fail(c, `Routing for ${hostname} does not serve the published site.`, deps);
        return;
      }
    }
    c.routing.activatedAt = deps.now();
    note(c, `Routing active for ${c.hostnames.join(', ')}.`);
    moveTo(c, 'ssl_pending', deps);
  },

  async ssl_pending(c, deps) {
    const cfg = domainConfig();
    const site = await loadSite(c);
    if (!site || site.status !== 'published') { fail(c, 'The project is no longer published.', deps, { recoverable: false }); return; }
    const caa = await deps.probes.caaStatus(c.apex).catch(() => ({ present: false, allowed: true }));
    if (caa.present && !caa.allowed) {
      c.ssl.status = 'failed'; c.ssl.error = 'CAA records block certificate issuance.'; c.markModified('ssl');
      waitFor(c, 5 * 60 * 1000, deps, { status: 'action_required', message: `A CAA record at ${caa.at} does not allow Let's Encrypt or ZeroSSL, so HTTPS cannot be issued.`, action: {
        type: 'caa-blocked', message: `Add a CAA record allowing "letsencrypt.org" at ${caa.at} (or remove the restriction). Veave retries automatically.`, records: [{ type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"' }] } });
      return;
    }
    const expected = await expectedAddresses(c, site, deps);
    c.ssl.status = 'pending'; c.ssl.lastCheckedAt = deps.now();
    const failures = [];
    let probe = null;
    for (const hostname of c.hostnames) {
      const resolved = await deps.probes.resolveAll(hostname);
      const ip = resolved.a.find((address) => expected.includes(address) && deps.probes.isPublicAddress(address));
      if (!ip) { failures.push(`${hostname} does not resolve to Veave yet`); continue; }
      // The first handshake for a new hostname makes the TLS terminator obtain a certificate on demand.
      const result = await deps.probes.tlsProbe({ ip, hostname, timeout: c.retries === 0 ? 60000 : 20000 });
      if (!result.ok) failures.push(`${hostname}: ${result.error || 'certificate not valid'}`);
      else probe = !probe || result.validTo < probe.validTo ? result : probe;
    }
    // A certificate that is about to expire has not been renewed yet: keep asking for a fresh one instead of calling it done.
    if (!failures.length && probe && probe.daysLeft !== null && probe.daysLeft < cfg.sslRenewWithinDays) failures.push(`the certificate expires in ${probe.daysLeft} days and has not renewed`);
    if (failures.length) {
      c.ssl.error = failures.join('; ').slice(0, 400);
      c.markModified('ssl');
      if (c.retries + 1 >= cfg.maxSslAttempts) {
        c.ssl.status = 'failed';
        if (c.health.lastSuccessAt) {
          // The site has been live: do not mark the whole connection failed. Keep serving, record the problem, look again later.
          c.stage = 'active'; c.status = 'active'; c.retries = 0; c.lastError = `HTTPS needs attention: ${c.ssl.error}`;
          c.nextRunAt = new Date(deps.now().getTime() + 60 * 60 * 1000);
          note(c, c.lastError, 'error');
          return;
        }
        fail(c, `HTTPS could not be set up: ${c.ssl.error}. Check that the domain's DNS points at Veave and has no CAA restriction; certificate authorities also limit repeated requests.`, deps);
        return;
      }
      waitFor(c, backoff(deps, c.retries, 20000, 15 * 60 * 1000), deps, { message: c.ssl.error });
      return;
    }
    Object.assign(c.ssl, { status: 'active', issuer: probe.issuer, validFrom: probe.validFrom, expiresAt: probe.validTo, error: null });
    c.markModified('ssl');
    note(c, `HTTPS certificate is valid until ${probe.validTo.toISOString().slice(0, 10)}.`);
    moveTo(c, 'checking_health', deps);
  },

  async checking_health(c, deps) {
    const cfg = domainConfig();
    const result = await runHealth(c, deps);
    applyHealth(c, result, deps);
    if (result.ok) { c.status = 'active'; c.stage = 'active'; c.retries = 0; c.lastError = null; c.actionRequired = null; c.failure = null; c.nextRunAt = new Date(deps.now().getTime() + cfg.healthIntervalMs); note(c, 'All live checks passed. The website is published.'); return; }
    if (result.tlsProblem) { c.stage = 'ssl_pending'; c.retries = 0; c.nextRunAt = deps.now(); note(c, `Certificate problem during health check: ${result.tlsProblem}`, 'warn'); return; }
    if (c.retries + 1 >= cfg.maxHealthAttempts) { fail(c, `The live website did not pass its checks: ${result.failures.join('; ')}`, deps); return; }
    waitFor(c, backoff(deps, c.retries, 15000, 5 * 60 * 1000), deps, { message: result.failures.join('; ') });
  },

  async active(c, deps) {
    const cfg = domainConfig();
    const result = await runHealth(c, deps);
    applyHealth(c, result, deps);
    c.nextRunAt = new Date(deps.now().getTime() + (result.ok ? cfg.healthIntervalMs : 10 * 60 * 1000));
    if (result.ok) { c.lastError = null; return; }
    c.lastError = result.failures.join('; ').slice(0, 500);
    note(c, `Live check found a problem: ${c.lastError}`, 'warn');
    // A certificate that is invalid or close to expiry is repaired by re-running issuance; routing stays untouched.
    if (result.tlsProblem) { c.stage = 'ssl_pending'; c.status = 'in_progress'; c.retries = 0; c.nextRunAt = deps.now(); }
  }
};

const originHost = () => new URL(hostingConfig().verifyOrigin).hostname;
const originPort = () => Number(new URL(hostingConfig().verifyOrigin).port) || 80;

/** Outside-in checks of every hostname. Returns { ok, failures[], checks, tlsProblem }. */
async function runHealth(c, deps) {
  const cfg = domainConfig();
  const site = await loadSite(c);
  const failures = [];
  const checks = [];
  let tlsProblem = null;
  if (!site || site.status !== 'published' || !site.activeVersion) return { ok: false, failures: ['The site is not published.'], checks, tlsProblem };
  const expected = await expectedAddresses(c, site, deps);
  const index = await deps.readActiveIndex(site).catch(() => null);
  if (!index) return { ok: false, failures: ['The published files are missing.'], checks, tlsProblem };
  let soonest = null;

  for (const hostname of c.hostnames) {
    const entry = { hostname };
    checks.push(entry);
    const dnsState = await dnsPointsHere(hostname, expected, deps);
    entry.dns = { ok: dnsState.ok, a: dnsState.a };
    if (!dnsState.ok) { failures.push(dnsState.problem); continue; }
    const ip = dnsState.a.find((address) => expected.includes(address) && deps.probes.isPublicAddress(address));
    if (!ip) { failures.push(`${hostname} resolves to an address Veave does not serve from.`); continue; }

    const canonicalHost = canonicalOf(c);
    const redirectsTo = canonicalHost && canonicalHost !== hostname && c.ssl.status === 'active' ? canonicalHost : null;

    const http = await deps.probes.request({ protocol: 'http:', ip, hostname, path: '/' }).catch((error) => ({ error: error.message }));
    entry.httpRedirect = !http.error && [301, 302, 307, 308].includes(http.status) && /^https:\/\//i.test(String(http.headers?.location || ''));
    if (!entry.httpRedirect) failures.push(`${hostname}: http:// does not redirect to https:// (${http.error || `HTTP ${http.status}`}).`);

    const cert = await deps.probes.tlsProbe({ ip, hostname });
    entry.tls = { ok: cert.ok, issuer: cert.issuer, daysLeft: cert.daysLeft, error: cert.error || null };
    if (!cert.ok) { failures.push(`${hostname}: ${cert.error || 'certificate not valid'}`); tlsProblem = cert.error || 'certificate not valid'; continue; }
    if (cert.daysLeft !== null && cert.daysLeft < cfg.sslRenewWithinDays) { failures.push(`${hostname}: the certificate expires in ${cert.daysLeft} days and has not renewed.`); tlsProblem = 'certificate close to expiry'; }
    if (!soonest || cert.validTo < soonest.validTo) soonest = cert;

    const page = await deps.probes.request({ protocol: 'https:', ip, hostname, path: '/' }).catch((error) => ({ error: error.message }));
    if (redirectsTo) {
      entry.content = { ok: [301, 308].includes(page.status) && String(page.headers?.location || '').includes(redirectsTo), status: page.status };
      if (!entry.content.ok) failures.push(`${hostname} should redirect to ${redirectsTo} (HTTP ${page.status || page.error}).`);
      continue;
    }
    entry.content = { ok: !page.error && page.status === 200 && page.hash === index.hash, status: page.status || null };
    if (!entry.content.ok) failures.push(`${hostname}: the live page ${page.error ? `could not be fetched (${page.error})` : page.status !== 200 ? `returned HTTP ${page.status}` : 'does not match the published website'}.`);
    // Single-page-app deep links and a real static asset.
    if (entry.content.ok) {
      const route = await deps.probes.request({ protocol: 'https:', ip, hostname, path: '/__veave_route_check__/nested' }).catch((error) => ({ error: error.message }));
      entry.route = { ok: !route.error && route.status === 200 && route.hash === index.hash };
      if (!entry.route.ok) failures.push(`${hostname}: nested routes do not serve the site.`);
      const asset = firstAsset(index.html.toString('utf8'));
      if (asset) {
        const response = await deps.probes.request({ protocol: 'https:', ip, hostname, path: asset }).catch((error) => ({ error: error.message }));
        entry.asset = { path: asset, ok: !response.error && response.status === 200 && !/text\/html/i.test(String(response.headers?.['content-type'] || '')) };
        if (!entry.asset.ok) failures.push(`${hostname}: ${asset} did not load (${response.error || `HTTP ${response.status}`}).`);
      }
    }
  }
  return { ok: failures.length === 0, failures, checks, tlsProblem, soonest };
}

function firstAsset(html) {
  const match = html.match(/(?:src|href)=["'](\/assets\/[^"'#?]+\.(?:js|css|mjs))["']/i);
  return match ? match[1] : null;
}

function canonicalOf(c) {
  if (c.kind === 'subdomain' || !c.includeWww || c.canonical === 'none') return null;
  return c.canonical === 'www' ? `www.${c.apex}` : c.apex;
}

function applyHealth(c, result, deps) {
  c.health.ok = result.ok;
  c.health.checkedAt = deps.now();
  if (result.ok) c.health.lastSuccessAt = deps.now();
  c.health.checks = { failures: result.failures, hosts: result.checks };
  c.markModified('health');
  if (result.soonest) {
    Object.assign(c.ssl, { status: 'active', issuer: result.soonest.issuer, validFrom: result.soonest.validFrom, expiresAt: result.soonest.validTo, lastCheckedAt: deps.now(), error: null });
    c.markModified('ssl');
  }
}

// ---- engine ------------------------------------------------------------------------------------------------------------
async function advance(connection, depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  for (let i = 0; i < STEP_LOOPS; i += 1) {
    const handler = handlers[connection.stage];
    if (!handler) break;
    const stageBefore = connection.stage;
    try {
      await handler(connection, deps);
    } catch (error) {
      logger.warn(`Domain ${connection.hostname} stage ${connection.stage} error: ${error.message}`);
      const transient = !error.statusCode || error.statusCode >= 500;
      if (transient && connection.retries < 12) waitFor(connection, backoff(deps, connection.retries, 15000, 10 * 60 * 1000), deps, { message: error.message });
      else fail(connection, error.message, deps, { recoverable: transient });
    }
    // A domain that never became healthy must not keep routing traffic after the workflow gave up.
    if (connection.stage === 'failed' && connection.routing.activatedAt && !connection.health.lastSuccessAt) {
      await releaseRouting(connection).catch((error) => logger.warn(`Could not release routing for ${connection.hostname}: ${error.message}`));
    }
    await connection.save();
    const waiting = connection.nextRunAt && connection.nextRunAt > deps.now();
    if (connection.stage === 'failed' || waiting || connection.stage === stageBefore) break;
  }
  return connection;
}

/** Removes the hostname -> site mapping this connection created. Never touches DNS or the deployment itself. */
async function releaseRouting(connection) {
  const primary = connection.kind === 'subdomain' ? connection.hostname : connection.apex;
  const site = connection.siteId ? await PublishedSite.findById(connection.siteId) : null;
  if (site && site.customDomain === primary) {
    await PublishedSite.updateOne({ _id: site._id }, { $unset: { customDomain: 1 }, $set: { customDomainStatus: 'none', customDomainToken: '', customDomainVerifiedAt: null, customDomainError: '', customDomainCanonical: '' } });
  }
  invalidateSite(site?.slug, primary);
  for (const hostname of connection.hostnames) invalidateSite(null, hostname);
  connection.routing.activatedAt = null;
}

/** One pass of the worker loop: lease due connections and advance each. */
async function tick(depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  const cfg = domainConfig();
  const now = deps.now();
  const due = await DomainConnection.find({
    live: true, status: { $in: ['in_progress', 'action_required', 'active'] }, nextRunAt: { $lte: now },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }]
  }).sort({ nextRunAt: 1 }).limit(20).select('_id');
  let processed = 0;
  for (const { _id } of due) {
    const leased = await DomainConnection.findOneAndUpdate(
      { _id, live: true, nextRunAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: new Date(now.getTime() + cfg.leaseMs) } }, { new: true });
    if (!leased) continue;
    try { await advance(leased, depsOverride); processed += 1; }
    catch (error) { logger.error(`Domain ${leased.hostname} worker error: ${error.stack || error.message}`); }
    finally { await DomainConnection.updateOne({ _id: leased._id }, { $set: { leaseUntil: null } }).catch(() => {}); }
  }
  return processed;
}

let timer = null;
function start() {
  if (timer) return;
  const run = () => tick().catch((error) => logger.error(`Domain orchestrator tick failed: ${error.message}`));
  timer = setInterval(run, domainConfig().tickMs);
  timer.unref?.();
  run();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

/** Ask for an immediate pass over one connection (user pressed "check again"); the loop still owns execution. */
async function runNow(connectionId, depsOverride = {}) {
  const connection = await DomainConnection.findOneAndUpdate(
    { _id: connectionId, live: true, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] },
    { $set: { leaseUntil: new Date(Date.now() + domainConfig().leaseMs), nextRunAt: new Date() } }, { new: true });
  if (!connection) return null;
  try { return await advance(connection, depsOverride); }
  finally { await DomainConnection.updateOne({ _id: connectionId }, { $set: { leaseUntil: null } }).catch(() => {}); }
}

module.exports = { advance, tick, start, stop, runNow, runHealth, releaseRouting, handlers, defaultDeps, canonicalOf };
