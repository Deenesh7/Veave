const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/veave';

function convertTypes(val, key = '') {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((item) => convertTypes(item));
  }
  if (typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = convertTypes(v, k);
    }
    return res;
  }
  if (typeof val === 'string') {
    if (
      (key === '_id' || (key.endsWith('Id') && key !== 'googleId' && key !== 'appleId' && key !== 'sessionId')) &&
      /^[0-9a-fA-F]{24}$/.test(val)
    ) {
      return new mongoose.Types.ObjectId(val);
    }
    if (
      (key.endsWith('At') || key === 'date' || key === 'createdAt' || key === 'updatedAt' || key === 'timestamp') &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(val)
    ) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return val;
}

async function restoreDatabase() {
  const dumpBaseDir = path.resolve(__dirname, '../../dump');
  const latestDir = path.join(dumpBaseDir, 'latest');
  const zipFile = path.join(dumpBaseDir, 'veave_mongo_dump.zip');

  if (!fs.existsSync(latestDir) && fs.existsSync(zipFile)) {
    console.log(`Extracting ${zipFile} into ${latestDir}...`);
    fs.mkdirSync(latestDir, { recursive: true });
    try {
      execSync(`unzip -o "${zipFile}" -d "${latestDir}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('Could not extract using unzip command:', e.message);
    }
  }

  if (!fs.existsSync(latestDir)) {
    console.error(`Error: Dump folder not found at ${latestDir}. Please extract veave_mongo_dump.zip first.`);
    process.exit(1);
  }

  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  console.log(`Connected to database: "${db.databaseName}"`);

  const files = fs.readdirSync(latestDir).filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'all_collections.json');

  let totalRestored = 0;
  for (const file of files) {
    const collName = path.basename(file, '.json');
    const content = fs.readFileSync(path.join(latestDir, file), 'utf-8');
    const rawDocs = JSON.parse(content);

    if (!Array.isArray(rawDocs) || rawDocs.length === 0) {
      console.log(`[SKIP] ${collName}: 0 documents.`);
      continue;
    }

    const docs = rawDocs.map((doc) => convertTypes(doc));
    const collection = db.collection(collName);

    try {
      // Clear existing seed or empty data for a clean restore
      await collection.deleteMany({});
      const result = await collection.insertMany(docs, { ordered: false });
      console.log(`[RESTORED] ${collName}: inserted ${result.insertedCount} documents`);
      totalRestored += result.insertedCount;
    } catch (insertErr) {
      const inserted = insertErr.result ? insertErr.result.nInserted : 0;
      console.log(`[PARTIAL] ${collName}: inserted ${inserted} documents`);
      totalRestored += inserted;
    }
  }

  console.log(`\n=== Restore Complete ===`);
  console.log(`Total documents inserted: ${totalRestored}`);
  await mongoose.disconnect();
}

restoreDatabase().catch((err) => {
  console.error('Failed to restore database:', err);
  process.exit(1);
});
