#!/usr/bin/env node
/**
 * Imports template versions from a directory into MongoDB (text files) and S3 (images).
 *
 *   node scripts/import-templates.cjs <directory>             # imports every <id>/<version> inside it
 *   node scripts/import-templates.cjs <directory> <id>        # only that template
 *   NODE_ENV=production node scripts/import-templates.cjs ... # the production database (default is development)
 *
 * Directory layout:  <directory>/<templateId>/<version>/{template.json, preview.svg, files/...}
 * Images (preview and files/public/**) go to S3; the document stores their references. Re-running replaces the document.
 */
require('../src/config/loadEnv');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const templates = require('../src/services/templates/templateService');
const TemplateDefinition = require('../src/models/TemplateDefinition');
const { uploadFile } = require('../src/services/storage/s3BlobStorage');

const IMAGE = /\.(svg|png|jpe?g|webp|gif|avif|ico)$/i;

(async () => {
  const [dir, only] = process.argv.slice(2);
  if (!dir) { console.error('Usage: node scripts/import-templates.cjs <directory> [templateId]'); process.exit(1); }
  const root = path.resolve(dir);
  if (!process.env.S3_BUCKET) { console.error('S3_BUCKET is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Database: ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} (${process.env.NODE_ENV || 'development'})`);
  await templates.preloadAssets({ root }); // images that are already in S3 (listed in assets.json) are downloaded first
  let count = 0;
  for (const id of fs.readdirSync(root).filter((name) => !only || name === only)) {
    if (!fs.statSync(path.join(root, id)).isDirectory()) continue;
    for (const version of fs.readdirSync(path.join(root, id))) {
      const versionDir = path.join(root, id, version);
      if (!fs.statSync(versionDir).isDirectory()) continue;
      const { manifest, files, preview } = templates.readTemplateDirectory(versionDir);
      templates.assembleTemplate(manifest, files, preview); // full validation before anything is stored
      const text = [];
      const assets = [];
      for (const file of files.values()) {
        if (IMAGE.test(file.path) && file.path.startsWith('public/')) {
          assets.push({ path: file.path, blob: await uploadFile({ path: `files/${file.path}`, content: file.content, encoding: 'utf8' }) });
        } else text.push({ path: file.path, content: file.content });
      }
      const previewBlob = await uploadFile({ path: manifest.previewImage, content: preview, encoding: 'utf8' });
      const contentHash = require('node:crypto').createHash('sha256').update(JSON.stringify([manifest, text, assets.map((a) => a.blob.sha256)])).digest('hex');
      await TemplateDefinition.findOneAndUpdate(
        { templateId: manifest.id, version: manifest.version },
        { $set: { manifest, files: text, assets, preview: { blob: previewBlob }, contentHash } },
        { upsert: true, new: true }
      );
      count += 1;
      console.log(`imported ${manifest.id}@${manifest.version}: ${text.length} files in MongoDB, ${assets.length + 1} images in S3`);
    }
  }
  await mongoose.disconnect();
  console.log(`done (${count} template version${count === 1 ? '' : 's'})`);
})().catch((error) => { console.error(error); process.exit(1); });
