#!/usr/bin/env node
/**
 * Writes the Indian-time companion of createdAt (users.createdAtIST, e.g. "2026-11-17 14:53:49 IST") for accounts that do not have it.
 * createdAt itself is never changed. Additive and safe to re-run.
 *
 *   node scripts/backfill-ist-time.cjs --dry-run
 *   NODE_ENV=production node scripts/backfill-ist-time.cjs
 */
require('../src/config/loadEnv');
const mongoose = require('mongoose');
const { toIST } = require('../src/utils/istTime');

(async () => {
  const dry = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Database: ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} (${process.env.NODE_ENV || 'development'})${dry ? ' [dry run]' : ''}`);
  const users = mongoose.connection.db.collection('users');
  let changed = 0;
  for await (const user of users.find({ $or: [{ createdAtIST: { $exists: false } }, { createdAtIST: '' }] }, { projection: { email: 1, createdAt: 1 } })) {
    const created = user.createdAt || user._id.getTimestamp(); // accounts without a createdAt use the time inside their _id
    const text = toIST(created);
    console.log(`  ${String(user.email).replace(/(.{2}).*@/, '$1***@')}  ${new Date(created).toISOString()}  ->  ${text}`);
    if (!dry) await users.updateOne({ _id: user._id }, { $set: { createdAtIST: text } });
    changed += 1;
  }
  console.log(`${dry ? 'Would update' : 'Updated'} ${changed} account(s).`);
  await mongoose.disconnect();
})().catch((error) => { console.error(error.message); process.exit(1); });
