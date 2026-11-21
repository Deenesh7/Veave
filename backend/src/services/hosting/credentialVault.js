// Encrypts customers' DNS API credentials at rest. AES-256-GCM, a fresh random IV per value, and the owner + provider bound in as
// authenticated data, so a stored value cannot be copied to another account or provider and still decrypt.
const crypto = require('node:crypto');
const { AppError } = require('../../utils/errors');

function key() {
  const configured = String(process.env.DNS_CREDENTIAL_KEY || '').trim();
  if (configured) {
    const raw = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64');
    if (raw.length !== 32) throw new AppError('DNS_CREDENTIAL_KEY must be 32 bytes (64 hex characters or base64).', 503);
    return raw;
  }
  if (process.env.NODE_ENV === 'production') throw new AppError('Saving DNS credentials is not configured on this server (DNS_CREDENTIAL_KEY).', 503);
  // Development and tests only: a stable key derived from the JWT secret.
  return crypto.createHash('sha256').update(`dev-dns-credentials:${process.env.JWT_SECRET || 'dev'}`).digest();
}

const aad = (userId, provider) => Buffer.from(`veave-dns|${userId}|${provider}`);

function encrypt(plain, { userId, provider }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(userId, provider));
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function decrypt(stored, { userId, provider }) {
  const [version, iv, tag, body] = String(stored || '').split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new AppError('The saved DNS credential could not be read. Save it again.', 409);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(userId, provider));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('The saved DNS credential could not be read. Save it again.', 409);
  }
}

module.exports = { encrypt, decrypt };
