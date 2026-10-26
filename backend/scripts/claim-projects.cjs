#!/usr/bin/env node
/**
 * Attach projects that were created while logged out (userId: null) to one account, so they count toward
 * that account's plan usage and can be published.
 *
 *   node scripts/claim-projects.cjs you@example.com            # dry run: shows what would change
 *   node scripts/claim-projects.cjs you@example.com --apply    # does it
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const [email, flag] = process.argv.slice(2);
  if (!email || email.startsWith('--')) {
    console.error('Usage: node scripts/claim-projects.cjs <account-email> [--apply]');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const user = await db.collection('users').findOne({ email: email.toLowerCase() });
  if (!user) { console.error(`No account with email ${email}`); process.exit(1); }
  const unowned = { $or: [{ userId: null }, { userId: { $exists: false } }] };
  const projects = await db.collection('projects').find(unowned).project({ name: 1, createdAt: 1 }).toArray();
  console.log(`${projects.length} unowned project(s) -> ${user.email}`);
  projects.forEach((p) => console.log(`  - ${p.name} (${p._id})`));
  if (flag !== '--apply') { console.log('\nDry run only. Re-run with --apply to assign them.'); }
  else {
    const ids = projects.map((p) => p._id);
    const a = await db.collection('projects').updateMany({ _id: { $in: ids } }, { $set: { userId: user._id } });
    const b = await db.collection('projectfiles').updateMany({ projectId: { $in: ids }, ...unowned }, { $set: { userId: user._id } });
    console.log(`\nAssigned ${a.modifiedCount} project(s) and ${b.modifiedCount} file record(s).`);
  }
  await mongoose.disconnect();
})().catch((error) => { console.error(error.message); process.exit(1); });
