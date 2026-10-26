const fs = require('node:fs/promises');
const path = require('node:path');
const { hostingConfig } = require('./config');
const { resolveInside } = require('./safePath');

const SAFE_ID = /^[a-zA-Z0-9]{8,40}$/;
const SAFE_VERSION = /^v[a-z0-9]{6,30}$/;

function siteDir(siteId) {
  if (!SAFE_ID.test(String(siteId))) throw new Error('Invalid site id');
  return path.join(hostingConfig().storageDir, 'sites', String(siteId));
}

function versionDir(siteId, version) {
  if (!SAFE_VERSION.test(String(version))) throw new Error('Invalid version id');
  return path.join(siteDir(siteId), version);
}

// Writes into <version>.partial then renames, so a version directory is either complete or absent.
async function writeVersion(siteId, version, files) {
  const finalDir = versionDir(siteId, version);
  const partialDir = `${finalDir}.partial`;
  await fs.rm(partialDir, { recursive: true, force: true });
  await fs.mkdir(partialDir, { recursive: true });
  let bytes = 0;
  for (const file of files) {
    const target = resolveInside(partialDir, file.path);
    if (!target) throw new Error(`Unsafe artifact path: ${file.path}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.buffer);
    bytes += file.buffer.length;
  }
  await fs.rename(partialDir, finalDir);
  return { dir: finalDir, bytes, fileCount: files.length };
}

async function removeVersion(siteId, version) {
  if (!version) return;
  const dir = versionDir(siteId, version);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(`${dir}.partial`, { recursive: true, force: true });
}

async function removeSite(siteId) {
  await fs.rm(siteDir(siteId), { recursive: true, force: true });
}

// Keeps the protected versions plus the newest few; everything else is deleted.
async function pruneVersions(siteId, protectedVersions, keep) {
  let entries = [];
  try { entries = await fs.readdir(siteDir(siteId), { withFileTypes: true }); } catch { return []; }
  const versions = entries.filter((entry) => entry.isDirectory() && SAFE_VERSION.test(entry.name)).map((entry) => entry.name).sort();
  const keepSet = new Set([...protectedVersions.filter(Boolean), ...versions.slice(-keep)]);
  const removed = [];
  for (const version of versions) {
    if (keepSet.has(version)) continue;
    await fs.rm(versionDir(siteId, version), { recursive: true, force: true }).catch(() => {});
    removed.push(version);
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('.partial')) await fs.rm(path.join(siteDir(siteId), entry.name), { recursive: true, force: true }).catch(() => {});
  }
  return removed;
}

module.exports = { siteDir, versionDir, writeVersion, removeVersion, removeSite, pruneVersions, SAFE_VERSION };
