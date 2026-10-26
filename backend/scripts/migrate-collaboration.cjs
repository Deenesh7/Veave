#!/usr/bin/env node
/**
 * Migration for group collaboration. Idempotent: safe to run repeatedly (and on every deploy).
 *
 *   node scripts/migrate-collaboration.cjs           # apply
 *   node scripts/migrate-collaboration.cjs --dry-run # report only
 *
 * 1. Creates the collections: groups, groupmemberships, groupinvitations, projectsharings, notifications, auditlogs
 * 2. Builds their unique constraints and indexes (group name/id, one membership per user per group,
 *    one pending invitation per user per group, one share per project/group and project/user)
 * 3. Backfills `revision: 0` on existing projects (the optimistic-concurrency counter)
 * 4. Adds a (projectId, ...) index used by the project-sharing lookups
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const MODELS = ['Group', 'GroupMembership', 'GroupInvitation', 'ProjectSharing', 'Notification', 'AuditLog'];

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/veave', { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  for (const name of MODELS) {
    const model = require(path.join('..', 'src', 'models', name));
    const collection = model.collection.collectionName;
    if (!existing.has(collection)) {
      console.log(`${dryRun ? '[dry-run] would create' : 'creating'} collection ${collection}`);
      if (!dryRun) await model.createCollection();
    }
    if (!dryRun) {
      const dropped = await model.syncIndexes();
      console.log(`indexes synced for ${collection}${dropped.length ? ` (dropped stale: ${dropped.join(', ')})` : ''}`);
    }
  }

  const missing = await db.collection('projects').countDocuments({ revision: { $exists: false } });
  console.log(`${missing} project(s) without a revision counter`);
  if (!dryRun && missing) {
    const res = await db.collection('projects').updateMany({ revision: { $exists: false } }, { $set: { revision: 0 } });
    console.log(`backfilled revision on ${res.modifiedCount} project(s)`);
  }

  await mongoose.disconnect();
  console.log(dryRun ? 'Dry run complete.' : 'Collaboration migration complete.');
})().catch((error) => { console.error(error); process.exit(1); });
