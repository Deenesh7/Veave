'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { validateBrowser, validatePlan } = require('./browserValidation.cjs');

const WORKSPACE = '/workspace';
const OUTPUT_LIMIT = 1024 * 1024;
const ARTIFACT_LIMIT = Number.parseInt(process.env.VEAVE_ARTIFACT_LIMIT_BYTES, 10) || 5 * 1024 * 1024;
const children = new Set();
let activeStage = 'startup';
let stopped = false;
const result = {
  ok: false, diagnostics: [], checks: [],
  coverage: { kind: 'bounded-smoke', exhaustive: false, skips: [], statement: 'Validation has not completed.' },
  artifacts: [], lockfile: '', visual: null
};

function emit(prefix, value, callback) {
  // Child stdout/stderr is NEVER forwarded as protocol lines; it is JSON-escaped inside diagnostics.
  process.stdout.write(`${prefix} ${JSON.stringify(value)}\n`, callback);
}

function failure(category, message, file = null, line = null, column = null) {
  result.diagnostics.push({ category, path: file, line, column, message });
}

function environment() {
  // No backend environment/credentials are inherited by project scripts.
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/home/pwuser',
    CI: 'true', NODE_ENV: 'development', NO_COLOR: '1',
    npm_config_cache: '/tmp/veave-npm-cache', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_ignore_scripts: activeStage === 'install' ? 'true' : 'false', npm_config_update_notifier: 'false',
    // Two different, nonexistent files: npm refuses to load the same path (/dev/null) as both user and global config.
    npm_config_userconfig: '/nonexistent/user.npmrc', npm_config_globalconfig: '/nonexistent/global.npmrc',
    npm_config_registry: 'https://registry.npmjs.org/', npm_config_fetch_retries: '1',
    ...(activeStage === 'install' ? {
      npm_config_proxy: 'http://registry-proxy:8080',
      npm_config_https_proxy: 'http://registry-proxy:8080', npm_config_noproxy: ''
    } : {}),
    npm_config_fetch_timeout: '30000', npm_config_progress: 'false',
    PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright'
  };
}

function kill(child, signal = 'SIGTERM') {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

async function stop(child) {
  if (!child) return;
  kill(child);
  await new Promise((resolve) => setTimeout(resolve, 150));
  kill(child, 'SIGKILL');
  children.delete(child);
}

function command(executable, args, timeoutMs) {
  if (stopped) throw new Error('Worker is stopping.');
  const child = spawn(executable, args, { cwd: WORKSPACE, env: environment(), detached: true,
    stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let bytes = 0;
  let output = '';
  let reason;
  let forceTimer;
  const terminate = (message) => {
    if (reason) return;
    reason = message;
    kill(child);
    forceTimer = setTimeout(() => kill(child, 'SIGKILL'), 500);
  };
  const capture = (chunk) => {
    bytes += chunk.length;
    if (bytes <= OUTPUT_LIMIT) output += chunk.toString('utf8');
    else terminate(`Command output exceeded ${OUTPUT_LIMIT} bytes.`);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const timer = setTimeout(() => terminate(`Command exceeded ${timeoutMs}ms.`), timeoutMs);
  const done = new Promise((resolve) => {
    child.on('error', (error) => { reason = error.stack || String(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      // Also terminate grandchildren left behind by a script that exited successfully.
      kill(child, 'SIGKILL');
      children.delete(child);
      resolve({ code, signal, output, reason });
    });
  });
  return { child, done, output: () => output };
}

async function run(executable, args, timeoutMs) {
  const execution = command(executable, args, timeoutMs);
  const outcome = await execution.done;
  if (outcome.code !== 0 || outcome.reason) {
    throw new Error(`${executable} ${args.join(' ')} failed (exit ${outcome.code}, signal ${outcome.signal || 'none'}).\n${outcome.reason || ''}\n${outcome.output}`);
  }
  return outcome.output;
}

async function exists(file) {
  try { await fs.lstat(path.join(WORKSPACE, file)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readRegular(file, maxBytes) {
  const absolute = path.join(WORKSPACE, file);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Unsupported or oversized file: ${file}`);
  return fs.readFile(absolute, 'utf8');
}

async function stage(name, task) {
  activeStage = name;
  emit('VEAVE_EVENT', { stage: name, status: 'running' });
  try {
    const value = await task();
    result.checks.push({ name, status: 'passed' });
    emit('VEAVE_EVENT', { stage: name, status: 'passed' });
    return value;
  } catch (error) {
    result.checks.push({ name, status: 'failed' });
    emit('VEAVE_EVENT', { stage: name, status: 'failed' });
    throw error;
  }
}

async function syntax() {
  const { parse } = require('@babel/parser');
  let entries = 0;
  let total = 0;
  let sources = 0;
  const start = result.diagnostics.length;
  async function walk(directory, relative, depth) {
    if (depth > 20) throw new Error('Source tree exceeds maximum depth 20.');
    for (const name of (await fs.readdir(directory)).sort()) {
      if (['node_modules', 'dist', '.git'].includes(name)) continue;
      if (++entries > 4000) throw new Error('Source tree exceeds 4000 entries.');
      const file = path.posix.join(relative, name);
      const absolute = path.join(directory, name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Source symlinks are unsupported: ${file}`);
      if (stat.isDirectory()) { await walk(absolute, file, depth + 1); continue; }
      if (!stat.isFile()) throw new Error(`Non-regular project file: ${file}`);
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(name)) continue;
      total += stat.size;
      sources++;
      if (total > 16 * 1024 * 1024) throw new Error('Source code exceeds 16 MiB.');
      const code = await readRegular(file, 2 * 1024 * 1024);
      try {
        const plugins = [];
        if (!/\.[cm]?ts$/.test(name)) plugins.push('jsx');
        if (/\.(?:[cm]?ts|tsx)$/.test(name)) plugins.push(['typescript', { dts: /\.d\.[cm]?ts$/.test(name) }]);
        parse(code, { sourceType: 'unambiguous', plugins });
      } catch (error) {
        failure('syntax', error.stack || String(error), file, error.loc?.line ?? null,
          error.loc?.column == null ? null : error.loc.column + 1);
        if (result.diagnostics.length - start >= 100) throw new Error('Syntax error limit reached (100).');
      }
    }
  }
  await walk(WORKSPACE, '', 0);
  if (!sources) throw new Error('Unsupported project: no JavaScript/TypeScript source files found.');
  if (result.diagnostics.length !== start) throw new Error('Source syntax validation failed; see syntax diagnostics.');
  return sources;
}

async function artifacts(collect) {
  const root = path.join(WORKSPACE, 'dist');
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('dist must be a real directory, not a symlink.');
  const files = [];
  let total = 0;
  let entries = 0;
  async function walk(directory, relative, depth) {
    if (depth > 20) throw new Error('dist exceeds maximum directory depth 20.');
    for (const name of (await fs.readdir(directory)).sort()) {
      if (++entries > 2000) throw new Error('dist exceeds 2000 entries.');
      const absolute = path.join(directory, name);
      const file = path.posix.join(relative, name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks in dist are unsupported: ${file}`);
      if (stat.isDirectory()) await walk(absolute, file, depth + 1);
      else if (stat.isFile()) {
        total += stat.size;
        if (total > ARTIFACT_LIMIT) throw new Error(`dist exceeds ${ARTIFACT_LIMIT} bytes.`);
        const content = await fs.readFile(absolute);
        files.push({ path: file, content: collect ? content.toString('base64') : createHash('sha256').update(content).digest('hex') });
      } else throw new Error(`Non-regular artifact: ${file}`);
    }
  }
  await walk(root, 'dist', 0);
  if (!files.some((file) => file.path === 'dist/index.html') || !(await readRegular('dist/index.html', ARTIFACT_LIMIT)).trim()) {
    throw new Error('A nonempty dist/index.html is required; alternate output directories are unsupported.');
  }
  return files;
}

// Publishing mode: the built site can be far larger than the 5 MB smoke-test artifact limit, and it is returned
// through a mounted directory instead of the protocol stream. Same safety rules: regular files only, no links.
async function exportDist(destination) {
  const limitBytes = Number.parseInt(process.env.VEAVE_EXPORT_LIMIT_BYTES, 10) || 200 * 1024 * 1024;
  const limitEntries = Number.parseInt(process.env.VEAVE_EXPORT_LIMIT_ENTRIES, 10) || 5000;
  const root = path.join(WORKSPACE, 'dist');
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('dist must be a real directory, not a symlink.');
  let total = 0;
  let entries = 0;
  async function walk(directory, relative, depth) {
    if (depth > 20) throw new Error('dist exceeds maximum directory depth 20.');
    await fs.mkdir(path.join(destination, relative), { recursive: true });
    for (const name of (await fs.readdir(directory)).sort()) {
      if (++entries > limitEntries) throw new Error(`dist exceeds ${limitEntries} entries.`);
      const absolute = path.join(directory, name);
      const rel = path.posix.join(relative, name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks in dist are unsupported: ${rel}`);
      if (stat.isDirectory()) await walk(absolute, rel, depth + 1);
      else if (stat.isFile()) {
        total += stat.size;
        if (total > limitBytes) throw new Error(`dist exceeds ${limitBytes} bytes.`);
        await fs.copyFile(absolute, path.join(destination, rel));
      } else throw new Error(`Non-regular artifact: ${rel}`);
    }
  }
  await walk(root, '', 0);
  if (!(await readRegular('dist/index.html', limitBytes)).trim()) throw new Error('A nonempty dist/index.html is required.');
  return { entries, total };
}

async function main() {
  const mode = process.argv[2];
  if (!['install', 'validate', 'build'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node /runner/worker.cjs install|validate|build');
  if (process.platform !== 'linux') throw new Error('The worker must run inside the Linux runner container.');
  if (mode === 'install') await fs.cp('/input', WORKSPACE, { recursive: true });
  await stage('manifest', async () => {
    const pkg = JSON.parse(await readRegular('package.json', 1024 * 1024));
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must be an object.');
    // A project-level npmrc could override the install registry, proxies or lifecycle policy.
    if (await exists('.npmrc')) throw new Error('Project .npmrc is unsupported. Use the runner dependency policy instead.');
    if (await exists('npm-shrinkwrap.json')) throw new Error('npm-shrinkwrap.json is unsupported; use package-lock.json.');
    for (const script of ['build', 'preview']) {
      if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script].trim()) {
        throw new Error(`Unsupported project: a real npm run ${script} script is required.`);
      }
    }
    return pkg;
  });
  if (mode === 'install') {
    await stage('install', async () => {
      const locked = await exists('package-lock.json');
      if (locked) {
        const lock = JSON.parse(await readRegular('package-lock.json', 8 * 1024 * 1024));
        const pkg = JSON.parse(await readRegular('package.json', 1024 * 1024));
        const signature = (value) => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
        const stale = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
          .some((key) => signature(pkg[key]) !== signature(lock.packages?.['']?.[key]));
        if (stale) await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], 120000);
      }
      await run('npm', [locked ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev', '--package-lock=true'], 240000);
      result.lockfile = await readRegular('package-lock.json', 8 * 1024 * 1024);
    });
    await stage('dependencies', () => run('npm', ['ls', '--all', '--json'], 30000));
    result.coverage = { kind: 'install-only', exhaustive: false, skips: ['Build and browser checks require validate mode.'] };
    result.ok = true;
    return;
  }
  if (mode === 'build') {
    await stage('build', async () => {
      await fs.rm(path.join(WORKSPACE, 'dist'), { recursive: true, force: true });
      await run('npm', ['run', 'build'], 300000);
    });
    await stage('artifacts', () => exportDist('/output'));
    result.coverage = { kind: 'build-only', exhaustive: false, skips: ['Preview and browser checks are validate mode only.'] };
    result.ok = result.diagnostics.length === 0;
    return;
  }
  result.lockfile = await readRegular('package-lock.json', 8 * 1024 * 1024);
  await stage('dependencies', () => run('npm', ['ls', '--all', '--json'], 30000));
  if (await exists('veave.validation.json')) {
    await stage('plan-schema', async () => {
      result.plan = validatePlan(JSON.parse(await readRegular('veave.validation.json', 128 * 1024)));
    });
  }
  await stage('syntax', syntax);
  if (await exists('tsconfig.json')) {
    await stage('types', async () => {
      await readRegular('tsconfig.json', 1024 * 1024);
      if (!await exists('node_modules/typescript/bin/tsc')) throw new Error('tsconfig.json exists but installed TypeScript tsc is missing. Declare typescript as a devDependency.');
      await run('node', ['node_modules/typescript/bin/tsc', '--noEmit'], 60000);
    });
  } else {
    result.checks.push({ name: 'types', status: 'not-applicable', reason: 'No tsconfig.json; build performs JavaScript/JSX syntax checking.' });
  }
  const builtFiles = await stage('build', async () => {
    // Remove stale output so a no-op script cannot pass using a previously supplied dist.
    await fs.rm(path.join(WORKSPACE, 'dist'), { recursive: true, force: true });
    await run('npm', ['run', 'build'], 120000);
    return artifacts(false);
  });
  let preview;
  try {
    await stage('preview', async () => {
      preview = command('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], 180000);
      let exit;
      preview.done.then((outcome) => { exit = outcome; });
      const index = await readRegular('dist/index.html', ARTIFACT_LIMIT);
      const deadline = Date.now() + 30000;
      let readinessError = '';
      while (Date.now() < deadline) {
        if (exit) throw new Error(`Preview exited before readiness.\n${exit.reason || ''}\n${exit.output}`);
        try {
          const response = await fetch('http://127.0.0.1:4173/', { redirect: 'error', signal: AbortSignal.timeout(1000) });
          if (response.ok) {
            // Vite preview must serve the built entry, not a separate dev-server artifact.
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > ARTIFACT_LIMIT) { await reader.cancel(); throw new Error('Preview entry exceeds artifact limit.'); }
              chunks.push(chunk.value);
            }
            if (Buffer.concat(chunks).toString('utf8') !== index) throw new Error('Preview response does not match dist/index.html.');
            return;
          }
          readinessError = `HTTP ${response.status} ${response.statusText}`;
          await response.body?.cancel();
        } catch (error) { readinessError = error.stack || String(error); }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`Preview was not ready within 30000ms.\n${readinessError}\n${preview.output()}`);
    });
    await stage('browser', async () => {
      const visualReferencePath = process.env.VEAVE_VISUAL_REFERENCE || undefined;
      if (visualReferencePath && visualReferencePath !== '/reference/reference-image') {
        throw new Error('Visual reference must use the fixed trusted runner path.');
      }
      const browserResult = await validateBrowser('http://127.0.0.1:4173/', {
        plan: result.plan,
        maxRoutes: Math.min(1000, Math.max(100, result.plan?.tests?.length || 0)),
        timeoutMs: Math.min(900000, Math.max(180000, (result.plan?.tests?.length || 0) * 5000)),
        visualReferencePath,
        visualThreshold: process.env.VEAVE_VISUAL_THRESHOLD
      });
      result.diagnostics.push(...browserResult.diagnostics);
      result.checks.push(...browserResult.checks);
      result.coverage = browserResult.coverage;
      result.visual = browserResult.visual;
      if (!browserResult.ok) throw new Error('Browser validation failed; see browser diagnostics.');
      if (preview.child.exitCode !== null || preview.child.signalCode !== null) throw new Error(`Preview exited during validation.\n${preview.output()}`);
    });
  } finally {
    await stop(preview?.child);
  }
  result.artifacts = await stage('artifacts', async () => {
    const files = await artifacts(true);
    const digests = files.map((file) => ({ path: file.path,
      content: createHash('sha256').update(Buffer.from(file.content, 'base64')).digest('hex') }));
    if (JSON.stringify(digests) !== JSON.stringify(builtFiles)) throw new Error('dist changed during preview/browser checks; refusing unvalidated artifacts.');
    return files;
  });
  result.ok = result.diagnostics.length === 0;
}

async function finish() {
  try { await main(); }
  catch (error) {
    result.ok = false;
    failure(activeStage, error.stack || String(error));
  } finally {
    stopped = true;
    await Promise.all([...children].map((child) => stop(child)));
    delete result.plan;
    if (!result.ok) result.artifacts = [];
    // Exit after flushing even if a failed browser left driver handles open.
    emit('VEAVE_RESULT', result, () => process.exit(result.ok ? 0 : 1));
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopped = true;
  for (const child of children) kill(child, 'SIGKILL');
  // Container cancellation is not a completed validation; the parent must reject a missing result.
  process.exit(signal === 'SIGTERM' ? 143 : 130);
});

finish();
