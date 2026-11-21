// DNSProviderService: the customer's DNS provider accounts (Cloudflare, GoDaddy) that Veave may use to configure THEIR domain.
//  - the owner gives an API credential once; it is checked with the provider, then stored encrypted (never returned to a browser);
//  - while connecting a domain, the workflow asks for the adapters that may change that domain's zone;
//  - what the owner chose in the publish window (automatic / one provider / manual) decides which of them may be used.
const DnsCredential = require('../../models/DnsCredential');
const vault = require('./credentialVault');
const logger = require('../../utils/logger');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { createCloudflareAdapter } = require('./providers/cloudflare');
const { createGoDaddyAdapter } = require('./providers/godaddy');

const PROVIDERS = {
  cloudflare: {
    label: 'Cloudflare',
    fields: [{ key: 'token', label: 'API token', secret: true }],
    help: 'Create an API token at dash.cloudflare.com/profile/api-tokens with the template "Edit zone DNS" and choose only your domain. Veave needs nothing more.',
    build: (secret, http) => createCloudflareAdapter({ token: secret, http }),
    shape: (input) => String(input.token || '').trim(),
    valid: (secret) => /^[A-Za-z0-9_-]{30,80}$/.test(secret) || 'That does not look like a Cloudflare API token (about 40 letters and numbers).'
  },
  godaddy: {
    label: 'GoDaddy',
    fields: [{ key: 'key', label: 'API key', secret: false }, { key: 'secret', label: 'API secret', secret: true }],
    help: 'Create a production key at developer.godaddy.com/keys. GoDaddy only turns its DNS API on for some accounts; if the key is rejected, use the manual records instead.',
    build: (secret, http) => createGoDaddyAdapter({ token: secret, http }),
    shape: (input) => (input.key && input.secret ? `${String(input.key).trim()}:${String(input.secret).trim()}` : String(input.token || '').trim()),
    valid: (secret) => /^[A-Za-z0-9_-]{6,80}:[A-Za-z0-9_-]{6,80}$/.test(secret) || 'Enter both the GoDaddy API key and the API secret.'
  }
};

const known = (provider) => { if (!PROVIDERS[provider]) throw new ValidationError('That DNS provider is not supported. Choose Cloudflare or GoDaddy, or use the manual records.'); return PROVIDERS[provider]; };
const hintOf = (secret) => `…${String(secret).slice(-4)}`;

/** Providers the owner can choose from, and which of them they have already connected (no secrets). */
async function listAccounts(userId) {
  const saved = await DnsCredential.find({ userId }).select('provider hint lastUsedAt lastError updatedAt').lean();
  return Object.entries(PROVIDERS).map(([id, provider]) => {
    const row = saved.find((item) => item.provider === id);
    return { provider: id, label: provider.label, fields: provider.fields, help: provider.help, connected: Boolean(row), hint: row?.hint || null, lastUsedAt: row?.lastUsedAt || null, error: row?.lastError || null, savedAt: row?.updatedAt || null };
  });
}

/** Checks the credential with the provider, then keeps it encrypted. A bad credential is never stored. */
async function saveAccount(userId, providerId, input, { http = null } = {}) {
  const provider = known(providerId);
  const secret = provider.shape(input || {});
  const format = provider.valid(secret);
  if (format !== true) throw new ValidationError(format);
  let check;
  try { check = await provider.build(secret, http || undefined).verifyToken(); }
  catch (error) { throw new ValidationError(error.transient ? `${provider.label} could not be reached right now. Try again in a minute.` : 'The credential could not be checked.'); }
  if (!check.ok) throw new ValidationError(check.reason || `${provider.label} did not accept this credential.`);
  const ciphertext = vault.encrypt(secret, { userId: String(userId), provider: providerId });
  await DnsCredential.findOneAndUpdate({ userId, provider: providerId }, { $set: { ciphertext, hint: hintOf(secret), lastError: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  logger.info(`DNS account saved: ${providerId} for user ${userId}`);
  return (await listAccounts(userId)).find((item) => item.provider === providerId);
}

async function removeAccount(userId, providerId) {
  known(providerId);
  const gone = await DnsCredential.deleteOne({ userId, provider: providerId });
  if (!gone.deletedCount) throw new NotFoundError('DNS account');
  return { provider: providerId, connected: false };
}

/**
 * The adapters that may change this connection's zone. What the owner chose decides: manual -> none; one provider -> only that
 * one; auto -> every account the owner connected. The provider's own check still has the final word (zone in the account, rights).
 */
async function adaptersFor(connection, { http = null } = {}) {
  const preference = connection.dns?.preference || 'auto';
  if (preference === 'manual') return [];
  const rows = await DnsCredential.find({ userId: connection.userId, ...(preference === 'auto' ? {} : { provider: preference }) }).select('+ciphertext provider').lean();
  const out = [];
  for (const row of rows) {
    try {
      const secret = vault.decrypt(row.ciphertext, { userId: String(connection.userId), provider: row.provider });
      out.push(known(row.provider).build(secret, http || undefined));
    } catch (error) {
      await DnsCredential.updateOne({ _id: row._id }, { $set: { lastError: 'This saved credential cannot be read. Save it again.' } }).catch(() => {});
      logger.warn(`DNS account ${row.provider} for user ${connection.userId} cannot be used: ${error.message}`);
    }
  }
  if (out.length) DnsCredential.updateMany({ userId: connection.userId, provider: { $in: out.map((adapter) => adapter.id) } }, { $set: { lastUsedAt: new Date(), lastError: null } }).catch(() => {});
  return out;
}

module.exports = { PROVIDERS, listAccounts, saveAccount, removeAccount, adaptersFor };
