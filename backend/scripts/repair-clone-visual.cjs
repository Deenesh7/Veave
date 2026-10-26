// Runs the same compare-with-the-real-site-and-repair loop a clone job runs, on a saved project.
//   node scripts/repair-clone-visual.cjs <projectId>            # dry run: prints what it found and what the model changed
//   node scripts/repair-clone-visual.cjs <projectId> --apply    # also saves the CSS the loop kept
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { hydrateFiles, dehydrateFiles } = require('../src/services/storage/s3BlobStorage');
const repair = require('../src/services/clone/cloneVisualRepair');
const validation = require('../src/services/ai/incrementalValidation');
const fidelity = require('../src/services/clone/fidelityAudit');
const sourceRefreshService = require('../src/services/clone/sourceRefreshService');
const { snapshotLivePage } = require('../src/services/clone/websiteCaptureService');
const { inspectRenderedPreview } = require('../src/services/ai/targetRenderVerifier');
const openrouter = require('../src/services/ai/openrouterService');

(async () => {
  const id = process.argv.slice(2).find((a) => /^[a-f0-9]{24}$/i.test(a));
  const apply = process.argv.includes('--apply');
  if (!id) throw new Error('give a project id');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const col = mongoose.connection.collection('projects');
  const project = await col.findOne({ _id: new mongoose.Types.ObjectId(id) });
  const files = await hydrateFiles(project.files);
  const model = process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL;
  const prov = { sourceUrl: project.provenance.sourceUrl, canonicalUrl: project.provenance.canonicalUrl };
  let usage = { prompt: 0, completion: 0 };
  const outcome = await repair.runCloneVisualRepair({
    files, routes: ['/'], maxPasses: Number(process.env.CLONE_VISUAL_REPAIR_PASSES) || 2, validation, fidelity,
    render: (f, o) => inspectRenderedPreview(f, o),
    reference: async (route) => { const url = sourceRefreshService.sourceUrlForRoute(prov, route); return { url, snapshot: await snapshotLivePage(url) }; },
    ask: async (messages) => { const c = await openrouter.generateCompletion(messages, { model, temperature: 0, max_tokens: 8000, reasoning: { effort: 'low', exclude: true }, response_format: false }); usage.prompt += c?.usage?.prompt_tokens || 0; usage.completion += c?.usage?.completion_tokens || 0; return c; },
    onState: async (note) => console.log(note)
  });
  console.log(JSON.stringify({ initial: outcome.initial, final: outcome.final, passes: outcome.passes, remaining: outcome.remaining, usage }, null, 1).slice(0, 6000));
  const css = outcome.files.find((f) => f.path === repair.SITE_CSS_PATH);
  console.log('--- CSS written by the model ---\n' + repair.currentBlock(css.content));
  if (apply && outcome.passes.length) {
    const [stored] = await dehydrateFiles([{ ...css }]);
    await col.updateOne({ _id: project._id }, { $set: { 'files.$[f]': stored }, $inc: { revision: 1 } }, { arrayFilters: [{ 'f.path': repair.SITE_CSS_PATH }] });
    console.log('saved');
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
