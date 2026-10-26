const mongoose = require('mongoose');

// The durable record of connecting one custom domain to one published project. It is both the state machine of the
// publish-a-domain workflow (advanced by services/hosting/domainOrchestrator) and the source of truth for routing:
// a hostname only serves a site while it is `claimed` (verified) and its routing step has completed.
const STAGES = [
  'validating_request', 'pending_verification', 'verified', 'configuring_dns', 'dns_pending', 'deploying',
  'configuring_routing', 'ssl_pending', 'checking_health', 'active', 'failed'
];
const ROUTED_STAGES = ['ssl_pending', 'checking_health', 'active'];

const eventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now }, stage: String, level: { type: String, default: 'info' }, message: String
}, { _id: false });

const domainConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishedSite', default: null, index: true },

  hostname: { type: String, required: true, lowercase: true, index: true },   // what the user asked for, normalised
  apex: { type: String, required: true, lowercase: true },                     // registrable domain (the DNS zone)
  kind: { type: String, enum: ['apex', 'subdomain'], required: true },
  includeWww: { type: Boolean, default: false },
  canonical: { type: String, enum: ['apex', 'www', 'none'], default: 'none' }, // which of root/www the other redirects to
  hostnames: [{ type: String, lowercase: true }],                              // every host this connection serves
  claimed: { type: Boolean, default: false },                                  // verified: exclusive across all accounts
  live: { type: Boolean, default: true },                                      // false once disconnected

  stage: { type: String, enum: STAGES, default: 'validating_request', index: true },
  // in_progress: workers are advancing it; action_required: waits for the user (manual DNS record); active; failed
  status: { type: String, enum: ['in_progress', 'action_required', 'active', 'failed', 'removed'], default: 'in_progress', index: true },
  actionRequired: { type: mongoose.Schema.Types.Mixed, default: null },        // { type, message, records[] }

  verification: {
    method: { type: String, enum: ['dns-txt', 'purchase-order', null], default: null },
    nonce: { type: String, default: '' },        // bound into the challenge value together with host, user and project
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastCheckedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null }
  },
  dns: {
    provider: { type: String, default: null },          // detected from the NS records, e.g. godaddy, cloudflare, unknown
    authorized: { type: Boolean, default: false },      // can Veave change this zone itself?
    mode: { type: String, enum: ['automatic', 'manual', null], default: null },
    confirmReplace: { type: Boolean, default: false },  // the user agreed to replace conflicting A/AAAA/CNAME records
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    conflicts: { type: mongoose.Schema.Types.Mixed, default: null },
    txtWritten: { type: Boolean, default: false },       // Veave itself published the ownership TXT record
    checks: { type: mongoose.Schema.Types.Mixed, default: null },
    appliedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null }
  },
  deployment: {
    deploymentId: { type: String, default: null },
    version: { type: String, default: null },
    waitingSince: { type: Date, default: null },
    readyAt: { type: Date, default: null }
  },
  routing: { activatedAt: { type: Date, default: null } },
  ssl: {
    status: { type: String, enum: ['none', 'pending', 'active', 'failed'], default: 'none' },
    issuer: { type: String, default: null },
    validFrom: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    error: { type: String, default: null }
  },
  health: {
    ok: { type: Boolean, default: false },
    checkedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    checks: { type: mongoose.Schema.Types.Mixed, default: null }
  },

  // Orchestration bookkeeping
  retries: { type: Number, default: 0 },          // consecutive attempts at the current step
  nextRunAt: { type: Date, default: () => new Date(), index: true },
  leaseUntil: { type: Date, default: null },      // worker lease: only one worker advances a connection at a time
  lastError: { type: String, default: null },
  failure: { type: mongoose.Schema.Types.Mixed, default: null }, // { stage, message, recoverable }
  history: { type: [eventSchema], default: [] },
  removedAt: { type: Date, default: null }
}, { timestamps: true });

// Exclusive ownership of a hostname applies only to verified claims. Anyone may have a pending request for the same
// name, so nobody can block a domain's real owner by registering it first.
domainConnectionSchema.index({ hostnames: 1 }, { unique: true, partialFilterExpression: { claimed: true } });
// One live workflow per project.
domainConnectionSchema.index({ projectId: 1 }, { unique: true, partialFilterExpression: { live: true } });

module.exports = mongoose.model('DomainConnection', domainConnectionSchema);
module.exports.STAGES = STAGES;
module.exports.ROUTED_STAGES = ROUTED_STAGES;
