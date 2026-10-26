// Finds (and with --apply, repairs) projects whose captured pages have images that load but are invisible or 0px wide.
//   node scripts/repair-captured-visibility.cjs               # report only, every project that has captured pages
//   node scripts/repair-captured-visibility.cjs <projectId> --apply
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { hydrateFiles, dehydrateFiles } = require('../src/services/storage/s3BlobStorage');
const guard = require('../src/services/clone/capturedVisibility');
const { applySourceIdentity } = require('../src/services/clone/sourceIdentity');

(async () => {
  const apply = process.argv.includes('--apply');
  const only = process.argv.slice(2).find((a) => /^[a-f0-9]{24}$/i.test(a));
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const col = mongoose.connection.collection('projects');
  const query = { 'files.path': guard.SITE_CSS_PATH, ...(only ? { _id: new mongoose.Types.ObjectId(only) } : {}) };
  for await (const project of col.find(query, { projection: { name: 1, files: 1, provenance: 1 } })) {
    try {
      const files = await hydrateFiles(project.files);
      const result = await guard.ensureCapturedContentVisible(files);
      const home = (project.provenance?.routes || []).find((r) => r.path === '/') || project.provenance?.routes?.[0] || {};
      const identity = applySourceIdentity(result.files, { assets: project.provenance?.assets || [], title: home.title, description: home.description });
      if (identity.applied.length) console.log(`  identity: ${identity.applied.join(', ')}`);
      const b = result.before || { hiddenCount: 0, collapsedCount: 0 };
      const a = result.after || b;
      console.log(`${project._id} ${project.name}: invisible ${b.hiddenCount}, collapsed ${b.collapsedCount}${result.applied ? ` -> fixable (remaining ${a.hiddenCount + a.collapsedCount})` : result.skipped ? ` (${result.skipped})` : ' (ok)'}`);
      if (apply && (result.applied || identity.applied.length)) {
        const original = new Map(files.map((f) => [f.path, f.content]));
        const changed = identity.files.filter((f) => original.get(f.path) !== f.content);
        const stored = await dehydrateFiles(changed.map((f) => ({ ...f })));
        for (const file of stored) await col.updateOne({ _id: project._id }, { $set: { 'files.$[f]': file }, $inc: { revision: 0 } }, { arrayFilters: [{ 'f.path': file.path }] });
        await col.updateOne({ _id: project._id }, { $inc: { revision: 1 } });
        console.log('  repaired');
      }
    } catch (error) { console.log(`${project._id}: skipped (${error.message.slice(0, 120)})`); }
  }
  await mongoose.disconnect();
  process.exit(0);
})();
