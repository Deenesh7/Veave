/**
 * A cache of installed packages for the build checks.
 *
 * Every check of a page used to install the site's packages again (13 s on a fast machine, 25 s on the server) although a page change
 * almost never changes package.json. The packages are kept in a Docker volume named after the exact package.json (and package-lock.json)
 * they were installed from; the next check with the same files restores them instead of installing. Nothing else is shared: the site's own
 * files are copied in fresh every time, the volume is mounted read-only into a container without network access, and a different
 * package.json or lock file is a different volume. A volume is used for 7 days, and only the newest few are kept.
 */
const crypto = require('node:crypto');

const PREFIX = 'veave-deps-';
const TTL_MS = (Number.parseInt(process.env.VEAVE_DEPS_CACHE_DAYS, 10) || 7) * 24 * 3600 * 1000;
const MAX_VOLUMES = Number.parseInt(process.env.VEAVE_DEPS_CACHE_MAX, 10) || 5;
const enabled = () => String(process.env.VEAVE_REUSE_PACKAGES || 'on').toLowerCase() !== 'off';

/** What the installed packages depend on: the package.json and package-lock.json the project came with, and the runner image. */
function dependencyKey(files, image = '') {
  const text = (name) => { const file = (files || []).find((item) => item.path === name); return file && typeof file.content === 'string' ? file.content : ''; };
  const manifest = text('package.json');
  if (!manifest) return null;
  return crypto.createHash('sha256').update(`${image}\n--package.json--\n${manifest}\n--package-lock.json--\n${text('package-lock.json')}`).digest('hex').slice(0, 32);
}
const volumeFor = (key) => `${PREFIX}${key}`;

/** Is there a complete, recent package volume for this key? (A marker is written last, so a half-copied volume never counts.) */
async function isReady({ docker, image, key }) {
  if (!enabled() || !key) return false;
  const check = "const s=require('fs').statSync('/deps/.ready',{throwIfNoEntry:false});process.exit(s&&Date.now()-s.mtimeMs<" + TTL_MS + '?0:1)';
  try {
    const outcome = await docker(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m',
      '--mount', `type=volume,source=${volumeFor(key)},target=/deps,readonly`, '--entrypoint', 'node', image, '-e', check], { timeout: 20000 });
    return outcome.code === 0;
  } catch { return false; }
}

const saving = new Map();
/** Keeps the packages that were just installed in `workspaceVolume` for the next check. Never throws: a failed save only costs the next run an install. */
async function save({ docker, image, key, workspaceVolume, log = () => {} }) {
  if (!enabled() || !key) return false;
  if (saving.has(key)) return saving.get(key);
  const task = (async () => {
    const volume = volumeFor(key);
    try {
      await docker(['volume', 'rm', '-f', volume], { timeout: 20000 }).catch(() => {});
      const created = await docker(['volume', 'create', volume], { timeout: 20000 });
      if (created.code !== 0) return false;
      const copy = "const fs=require('fs');fs.cpSync('/ws/node_modules','/deps/node_modules',{recursive:true,verbatimSymlinks:true});"
        + "if(fs.existsSync('/ws/package-lock.json'))fs.copyFileSync('/ws/package-lock.json','/deps/package-lock.json');"
        + "fs.writeFileSync('/deps/.ready',String(Date.now()))";
      const outcome = await docker(['run', '--rm', '--user', 'root', '--network', 'none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=512m',
        '--mount', `type=volume,source=${workspaceVolume},target=/ws,readonly`, '--mount', `type=volume,source=${volume},target=/deps`,
        '--entrypoint', 'node', image, '-e', copy], { timeout: 120000 });
      if (outcome.code !== 0) { await docker(['volume', 'rm', '-f', volume], { timeout: 20000 }).catch(() => {}); log(`The package cache could not be saved: ${outcome.output.slice(0, 200)}`); return false; }
      await prune({ docker, keep: volume });
      return true;
    } catch (error) {
      log(`The package cache could not be saved: ${error.message}`);
      await docker(['volume', 'rm', '-f', volumeFor(key)], { timeout: 20000 }).catch(() => {});
      return false;
    }
  })();
  saving.set(key, task);
  try { return await task; } finally { saving.delete(key); }
}

/** Only the newest few package volumes (and none older than the limit) are kept. */
async function prune({ docker, keep = '' }) {
  try {
    const listed = await docker(['volume', 'ls', '-q', '--filter', `name=${PREFIX}`], { timeout: 20000 });
    const names = listed.output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(PREFIX));
    if (names.length <= MAX_VOLUMES) return;
    const dated = [];
    for (const name of names) {
      const info = await docker(['volume', 'inspect', '--format', '{{.CreatedAt}}', name], { timeout: 20000 });
      dated.push({ name, at: Date.parse(info.output.trim()) || 0 });
    }
    dated.sort((a, b) => b.at - a.at);
    for (const old of dated.slice(MAX_VOLUMES)) if (old.name !== keep) await docker(['volume', 'rm', '-f', old.name], { timeout: 20000 }).catch(() => {});
  } catch { /* the cache is an optimisation: a failed clean-up is not an error */ }
}

module.exports = { dependencyKey, volumeFor, isReady, save, prune, enabled, PREFIX };
