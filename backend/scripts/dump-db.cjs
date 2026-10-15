const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/veave';

async function dumpDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpBaseDir = path.resolve(__dirname, '../../dump');
  const dumpDir = path.join(dumpBaseDir, `veave_dump_${timestamp}`);
  const latestDir = path.join(dumpBaseDir, 'latest');

  fs.mkdirSync(dumpDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  console.log(`Connected to database: "${db.databaseName}"`);

  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    console.log('No collections found in this database.');
  }

  const summary = {
    database: db.databaseName,
    dumpTimestamp: new Date().toISOString(),
    connectionUri: uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'),
    collections: {},
    totalDocuments: 0,
  };

  const consolidatedData = {};

  for (const collInfo of collections) {
    const collName = collInfo.name;
    // Skip system collections
    if (collName.startsWith('system.')) continue;

    const collection = db.collection(collName);
    const docs = await collection.find({}).toArray();
    summary.collections[collName] = docs.length;
    summary.totalDocuments += docs.length;
    consolidatedData[collName] = docs;

    const jsonFilePath = path.join(dumpDir, `${collName}.json`);
    const latestFilePath = path.join(latestDir, `${collName}.json`);
    const jsonContent = JSON.stringify(docs, null, 2);

    fs.writeFileSync(jsonFilePath, jsonContent, 'utf-8');
    fs.writeFileSync(latestFilePath, jsonContent, 'utf-8');
    console.log(`[DUMPED] ${collName}: ${docs.length} documents -> ${collName}.json`);
  }

  // Save summary
  fs.writeFileSync(path.join(dumpDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  fs.writeFileSync(path.join(latestDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  // Save consolidated dump
  fs.writeFileSync(path.join(dumpDir, 'all_collections.json'), JSON.stringify(consolidatedData, null, 2), 'utf-8');
  fs.writeFileSync(path.join(latestDir, 'all_collections.json'), JSON.stringify(consolidatedData, null, 2), 'utf-8');

  console.log('\n=== Dump Completed Successfully ===');
  console.log(`Total Collections: ${Object.keys(summary.collections).length}`);
  console.log(`Total Documents: ${summary.totalDocuments}`);
  console.log(`Dump directory: ${dumpDir}`);
  console.log(`Latest link/folder: ${latestDir}`);

  await mongoose.disconnect();
}

dumpDatabase().catch((err) => {
  console.error('Failed to dump database:', err);
  process.exit(1);
});
