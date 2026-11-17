#!/usr/bin/env node
/**
 * Moves everything bulky out of MongoDB documents into S3 and leaves a small reference behind.
 *
 *   node scripts/move-to-s3.cjs --dry-run          # only report what would move
 *   node scripts/move-to-s3.cjs                    # do it
 *   NODE_ENV=production node scripts/move-to-s3.cjs
 *
 * What moves:
 *   1. projects.provenance.assets / assetQueue (the crawler's per-image records, often 100+ MB in total) -> one S3 object per project,
 *      referenced by provenance.captureAssetsBlob. Nothing reads them while editing.
 *   3. compiled preview pages (precompiledpreviews.html, 1-4 MB each) -> S3, referenced by htmlBlob. They are rebuilt on demand anyway.
 *   2. file contents still stored inline in projects.files and projectversions.files -> S3, with the same blob reference
 *      the application itself writes (content becomes '').
 *
 * Safe to re-run. Each document is updated only if it did not change while its files were uploading (compare on updatedAt / _id), the
 * upload is checked before anything is removed, and writes go straight to the collection, so no revision is bumped and no preview rebuilt.
 */
require('../src/config/loadEnv');
const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const s3 = require('../src/services/storage/s3BlobStorage');

const DRY = process.argv.includes('--dry-run');
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

async function moveFiles(files) {
  let moved = 0; let bytes = 0;
  const next = [];
  for (const file of files || []) {
    const inline = typeof file.content === 'string' && file.content.length > 0 && !(file.blob && file.blob.provider === 's3');
    if (!inline) { next.push(file); continue; }
    bytes += file.content.length; moved += 1;
    if (DRY) { next.push(file); continue; }
    const blob = await s3.uploadFile(file);
    next.push({ ...file, content: '', blob });
  }
  return { files: next, moved, bytes };
}

(async () => {
  if (!s3.isConfigured()) { console.error('S3_BUCKET is not set. Nothing can be moved.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Database: ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} (${process.env.NODE_ENV || 'development'})${DRY ? '  [dry run]' : ''}`);
  const db = mongoose.connection.db;
  const totals = { provenance: 0, files: 0, versionFiles: 0, previews: 0, bytes: 0 };

  // 1 + 2 for projects
  const projects = db.collection('projects');
  for await (const { _id } of projects.find({}, { projection: { _id: 1 } })) {
    const doc = await projects.findOne({ _id });
    if (!doc) continue;
    const set = {}; const unset = {};
    const heavy = doc.provenance && (doc.provenance.assets || doc.provenance.assetQueue);
    if (heavy) {
      const payload = { assets: doc.provenance.assets || [], assetQueue: doc.provenance.assetQueue || [] };
      const size = Buffer.byteLength(JSON.stringify(payload));
      totals.provenance += size; totals.bytes += size;
      if (!DRY) {
        const blob = await s3.putJson('provenance/capture-assets', payload);
        const check = await s3.getJson(blob);
        if (check.assets.length !== payload.assets.length || check.assetQueue.length !== payload.assetQueue.length) throw new Error(`Upload check failed for project ${_id}`);
        set['provenance.captureAssetsBlob'] = blob; unset['provenance.assets'] = ''; unset['provenance.assetQueue'] = '';
      }
    }
    const moved = await moveFiles(doc.files);
    if (moved.moved) { totals.files += moved.moved; totals.bytes += moved.bytes; set.files = moved.files; }
    if (!DRY && (Object.keys(set).length || Object.keys(unset).length)) {
      const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
      const result = await projects.updateOne({ _id, updatedAt: doc.updatedAt }, update);
      if (!result.matchedCount) console.warn(`  project ${_id} changed while moving; skipped (run again).`);
      else console.log(`  project ${_id}: moved${heavy ? ' provenance' : ''}${moved.moved ? ` + ${moved.moved} files` : ''}`);
    }
  }

  // 2 for saved versions
  const versions = db.collection('projectversions');
  for await (const { _id } of versions.find({}, { projection: { _id: 1 } })) {
    const doc = await versions.findOne({ _id });
    if (!doc) continue;
    const moved = await moveFiles(doc.files);
    if (!moved.moved) continue;
    totals.versionFiles += moved.moved; totals.bytes += moved.bytes;
    if (!DRY) { await versions.updateOne({ _id }, { $set: { files: moved.files } }); console.log(`  version ${_id}: moved ${moved.moved} files`); }
  }

  // 3 for compiled previews
  const previews = db.collection('precompiledpreviews');
  for await (const { _id } of previews.find({ html: { $type: 'string', $ne: '' } }, { projection: { _id: 1 } })) {
    const doc = await previews.findOne({ _id }, { projection: { html: 1 } });
    if (!doc || !doc.html) continue;
    totals.previews += 1; totals.bytes += doc.html.length;
    if (DRY) continue;
    const blob = await s3.uploadFile({ path: 'preview/index.html', content: doc.html, encoding: 'utf8' });
    const check = await s3.hydrateFile({ blob, content: '', encoding: 'utf8' });
    if (check.content.length !== doc.html.length) throw new Error(`Upload check failed for preview ${_id}`);
    await previews.updateOne({ _id, html: doc.html }, { $set: { html: '', htmlBlob: blob } });
    console.log(`  preview ${_id}: moved ${mb(doc.html.length)}`);
  }

  console.log(`\n${DRY ? 'Would move' : 'Moved'}: ${mb(totals.provenance)} of crawler records, ${totals.files} project files, ${totals.versionFiles} version files, ${totals.previews} compiled previews (${mb(totals.bytes)} in total).`);
  if (!DRY) console.log('Tip: run `db.runCommand({ compact: "projects" })` in mongosh to give the freed space back to the disk.');
  await mongoose.disconnect();
})().catch((error) => { console.error('Failed:', error.message); process.exit(1); });
