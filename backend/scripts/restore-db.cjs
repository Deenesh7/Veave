const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/veave';

async function restoreDatabase() {
  const dumpBaseDir = path.resolve(__dirname, '../../dump');
  const latestDir = path.join(dumpBaseDir, 'latest');
  const zipFile = path.join(dumpBaseDir, 'veave_mongo_dump.zip');

  // If latestDir doesn't exist but zip exists, give instructions
  if (!fs.existsSync(latestDir)) {
    if (fs.existsSync(zipFile)) {
      console.log(`Extracting ${zipFile} into ${latestDir}...`);
      const AdmZip = require('adm-zip'); // or unzip via powershell/tar
      // If adm-zip is not installed, fallback to extracting
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
    const docs = JSON.parse(content);

    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`[SKIP] ${collName}: 0 documents.`);
      continue;
    }

    const collection = db.collection(collName);
    // Insert documents; using ordered: false so duplicates are skipped
    try {
      const result = await collection.insertMany(docs, { ordered: false });
      console.log(`[RESTORED] ${collName}: inserted ${result.insertedCount} documents`);
      totalRestored += result.insertedCount;
    } catch (insertErr) {
      const inserted = insertErr.result ? insertErr.result.nInserted : 0;
      console.log(`[PARTIAL] ${collName}: inserted ${inserted} documents (some may already exist)`);
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
