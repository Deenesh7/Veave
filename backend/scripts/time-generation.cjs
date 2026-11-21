'use strict';
// Runs ONE real generation (real model, real image providers, Docker build) in an isolated database and prints where the time went.
// It spends real OpenRouter credit. Usage:
//   node scripts/time-generation.cjs "A website for a small neighbourhood bakery" [mongodb://localhost:27017/veave_timing]
const path = require('node:path');
const Module = require('node:module');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.development') });
process.env.ENABLE_DOCKER_VALIDATION = process.env.ENABLE_DOCKER_VALIDATION || 'true';
process.env.VEAVE_PREVIEW_ORIGIN = process.env.VEAVE_PREVIEW_ORIGIN || 'http://{token}.localhost:5000';
process.env.PRECOMPILE_PREVIEWS = 'false';
// Project files live in S3 in production; this run keeps them in the database document.
const originalLoad = Module._load;
Module._load = function patched(request, parent, ...rest) {
  if (/storage\/s3BlobStorage$/.test(request)) {
    return { dehydrateFiles: async (files) => files.map((f) => (f?.toObject ? f.toObject() : f)), hydrateFiles: async (files) => files, hydrateFile: async (f) => f, isConfigured: () => false, blobs: new Map() };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

(async () => {
  const prompt = process.argv[2] || 'A website for a small neighbourhood bakery with menu, about and contact pages';
  const uri = process.argv[3] || 'mongodb://localhost:27017/veave_timing';
  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  const jobManager = require('../src/services/ai/jobManager');
  const GenerationJob = require('../src/models/GenerationJob');
  const User = require('../src/models/User');
  const user = await User.create({ name: 'Timing', email: `timing-${Date.now()}@example.com`, password: 'password-123', creditsExempt: true });
  const started = Date.now();
  const job = await jobManager.createJob({ type: 'generate', payload: { type: 'generate', prompt }, userId: user._id });
  let finished;
  for (;;) {
    finished = await GenerationJob.findOne({ jobId: job.jobId });
    if (['completed', 'failed', 'cancelled'].includes(finished.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const images = finished.analysis?.imagePipeline || {};
  console.log(JSON.stringify({
    status: finished.status, seconds, error: finished.error || null,
    timings: Object.fromEntries(Object.entries(finished.analysis?.timings?.stages || {}).map(([k, v]) => [k, `${Math.round(v.ms / 1000)}s x${v.calls}`])),
    images: { found: images.found ?? images.assets?.length ?? null, missing: images.missing?.length ?? images.missingCount ?? null }
  }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
