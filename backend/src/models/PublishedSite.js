const mongoose = require('mongoose');

// One hosted site per project. The slug maps `<slug>.<PUBLISH_BASE_DOMAIN>` to the active build.
const publishedSiteSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ['unpublished', 'published'], default: 'unpublished' },
  activeVersion: { type: String, default: null },
  previousVersion: { type: String, default: null },
  activeDeploymentId: { type: String, default: null },
  firstPublishedAt: { type: Date, default: null },
  lastPublishedAt: { type: Date, default: null },
  unpublishedAt: { type: Date, default: null },
  // Custom domain (e.g. example.com) served in addition to <slug>.<base>; verified through DNS.
  customDomain: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  customDomainStatus: { type: String, enum: ['none', 'pending', 'verified'], default: 'none' },
  customDomainToken: { type: String, default: '' },
  customDomainVerifiedAt: { type: Date, default: null },
  customDomainError: { type: String, default: '' },
  // Set by the domain workflow (DomainConnection). `customDomainWww`: www.<domain> is served too; the canonical host
  // ('apex' | 'www' | '') is where the other one redirects once HTTPS is active.
  customDomainWww: { type: Boolean, default: true },
  customDomainCanonical: { type: String, default: '' },
  // Deployment lock: only one publish per site at a time (stale locks expire).
  publishingSince: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PublishedSite', publishedSiteSchema);
