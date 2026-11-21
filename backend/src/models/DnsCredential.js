const mongoose = require('mongoose');

// A customer's DNS-provider API credential, so Veave can add the records for THEIR domain on their behalf.
// The secret is stored only as AES-256-GCM ciphertext (see services/hosting/credentialVault); it is never sent to a browser.
const dnsCredentialSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, enum: ['cloudflare', 'godaddy'], required: true },
  ciphertext: { type: String, required: true, select: false },
  hint: { type: String, default: '' },          // last characters only, so the owner can tell which token is saved
  lastUsedAt: { type: Date, default: null },
  lastError: { type: String, default: null }
}, { timestamps: true });

dnsCredentialSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('DnsCredential', dnsCredentialSchema);
