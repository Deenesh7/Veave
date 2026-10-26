const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hostingConfig } = require('./config');
const { resolveInside } = require('./safePath');
const { validateFilePaths, formatDiagnostics } = require('../ai/generationPipeline');
const { executeProject, dependencyPolicy, isDockerAvailable } = require('../ai/executionRunner');
const { scaffoldReactProject } = require('../project/reactScaffolder');

class BuildError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'BuildError';
    this.details = details;
  }
}

function run(command, args, { cwd, env, timeout, signal, maxOutput = 4 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    let output = '';
    let settled = false;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => { kill(); finish(Object.assign(new Error('Publish cancelled'), { name: 'AbortError' })); };
    const timer = setTimeout(() => { kill(); finish(new BuildError(`${path.basename(command)} timed out after ${Math.round(timeout / 1000)}s.`, output.slice(-4000))); }, timeout);
    signal?.addEventListener('abort', onAbort, { once: true });
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > maxOutput) { kill(); finish(new BuildError('Build output limit exceeded.', output.slice(-4000))); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => finish(new BuildError(`Could not start ${command}: ${error.message}`)));
    child.on('close', (code) => finish(null, { code, output }));
  });
}

// Prepare the exact project that will be built: scaffold missing manifest, then enforce path + dependency policy.
function prepareProjectFiles(projectFiles, projectName) {
  const source = (projectFiles || []).map(({ path: filePath, content, language, encoding }) => ({ path: filePath, content: content ?? '', language, encoding }));
  if (!source.length) throw new BuildError('This project has no files to publish.');
  const files = source.some((file) => file.path === 'package.json') ? source : scaffoldReactProject(source, { projectName });
  const pathErrors = validateFilePaths(files);
  if (pathErrors.length) throw new BuildError(`Project structure is invalid: ${formatDiagnostics(pathErrors)}`);
  try { dependencyPolicy(files); } catch (error) { throw new BuildError(error.message); }
  if (!files.some((file) => file.path === 'index.html')) throw new BuildError('Project has no index.html entry; a static site needs one.');
  return files;
}

async function collectDist(distDir, { maxBytes, maxFiles }) {
  const output = [];
  let total = 0;
  const walk = async (directory, prefix) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new BuildError(`Build output contains a symbolic link (${relative}); refusing to publish it.`);
      if (entry.isDirectory()) { await walk(absolute, relative); continue; }
      if (!entry.isFile()) continue;
      if (output.length >= maxFiles) throw new BuildError(`Build output has more than ${maxFiles} files.`);
      const buffer = await fs.readFile(absolute);
      total += buffer.length;
      if (total > maxBytes) throw new BuildError(`Build output is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      output.push({ path: relative, buffer });
    }
  };
  await walk(distDir, '');
  return output;
}

function assertSiteArtifacts(files) {
  if (!files.some((file) => file.path === 'index.html')) throw new BuildError('Build finished but produced no index.html.');
  for (const file of files) {
    if (!resolveInside('/x', file.path)) throw new BuildError(`Unsafe build artifact path: ${file.path}`);
  }
  return files;
}

async function buildInDocker(files, { signal, log }) {
  const config = hostingConfig();
  log('Building in an isolated Docker container (no network during build, build-only mode).');
  // The container writes the finished site into this directory; it is read back with symlink and size checks.
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-site-'));
  await fs.chmod(outputDirectory, 0o777);
  try {
    const result = await executeProject(files, { signal, mode: 'build', outputDirectory });
    if (!result.ok) {
      const first = (result.diagnostics || [])[0];
      const message = first ? `${first.category}${first.path ? ` in ${first.path}` : ''}: ${first.message}` : 'Build failed.';
      throw new BuildError(`Build failed - ${message}`, result.diagnostics);
    }
    return await collectDist(outputDirectory, { maxBytes: config.maxSiteBytes, maxFiles: config.maxSiteFiles });
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildLocally(files, { signal, log }) {
  const config = hostingConfig();
  const pkg = JSON.parse(files.find((file) => file.path === 'package.json').content || '{}');
  const buildScript = String(pkg.scripts?.build || '').trim();
  if (!/^vite(\s+build)?(\s+--[\w-]+(\s+[\w./-]+)?)*$/.test(buildScript)) {
    throw new BuildError(`package.json "build" script must be "vite build" (found "${buildScript || 'none'}"). Custom build commands are not run on the server.`);
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-publish-'));
  try {
    for (const file of files) {
      const target = resolveInside(directory, file.path);
      if (!target) throw new BuildError(`Unsafe path: ${file.path}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content);
    }
    await fs.mkdir(config.npmCacheDir, { recursive: true });
    // Scrubbed environment: no server secrets (DB URI, JWT, API keys) reach project code.
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      TMPDIR: directory,
      CI: '1',
      NODE_ENV: 'development',
      npm_config_cache: config.npmCacheDir,
      npm_config_update_notifier: 'false',
      NODE_OPTIONS: '--max-old-space-size=1536'
    };
    const hasLock = files.some((file) => file.path === 'package-lock.json');
    log(`Installing dependencies (${hasLock ? 'npm ci' : 'npm install'}, install scripts disabled).`);
    const install = await run('npm', [hasLock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: directory, env, timeout: config.installTimeoutMs, signal });
    if (install.code !== 0) throw new BuildError('Dependency installation failed.', install.output.slice(-4000));
    const viteBin = path.join(directory, 'node_modules', 'vite', 'bin', 'vite.js');
    try { await fs.access(viteBin); } catch { throw new BuildError('Vite is not listed in the project dependencies, so it cannot be built.'); }
    log('Running vite build.');
    const build = await run(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], { cwd: directory, env, timeout: config.buildTimeoutMs, signal });
    if (build.code !== 0) throw new BuildError(`Build failed:\n${build.output.slice(-3000)}`, build.output.slice(-4000));
    return await collectDist(path.join(directory, 'dist'), { maxBytes: config.maxSiteBytes, maxFiles: config.maxSiteFiles })
      .catch((error) => { if (error.code === 'ENOENT') throw new BuildError('Build finished but no dist/ folder was produced.'); throw error; });
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Build the project's existing source into static production files.
 * Prefers the Docker runner (real isolation). A local build is used only when allowed by configuration.
 * @returns {{ files: {path:string, buffer:Buffer}[], mode:'docker'|'local' }}
 */
async function buildStaticSite(projectFiles, { projectName, signal, log = () => {}, forceMode } = {}) {
  const config = hostingConfig();
  const files = prepareProjectFiles(projectFiles, projectName);
  let mode = forceMode;
  if (!mode) mode = (await isDockerAvailable().catch(() => false)) ? 'docker' : 'local';
  if (mode === 'local' && !config.allowLocalBuild) {
    throw new BuildError('No isolated build environment is available. Build the validator image (npm run runner:build in backend) and start Docker, or set PUBLISH_ALLOW_LOCAL_BUILD=true on a trusted server.');
  }
  const built = mode === 'docker' ? await buildInDocker(files, { signal, log }) : await buildLocally(files, { signal, log });
  const total = built.reduce((sum, file) => sum + file.buffer.length, 0);
  if (total > config.maxSiteBytes) throw new BuildError(`Build output is larger than ${Math.round(config.maxSiteBytes / 1024 / 1024)} MB.`);
  if (built.length > config.maxSiteFiles) throw new BuildError(`Build output has more than ${config.maxSiteFiles} files.`);
  return { files: assertSiteArtifacts(built), mode };
}

module.exports = { buildStaticSite, prepareProjectFiles, BuildError, collectDist };
