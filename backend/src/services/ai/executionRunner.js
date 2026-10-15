const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateFilePaths } = require('./generationPipeline');

function docker(args, { signal, onEvent, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { shell: false, windowsHide: true });
    let output = '';
    let pending = '';
    let failure;
    const fail = (error) => { failure = error; child.kill(); };
    const abort = () => fail(Object.assign(new Error('Validation cancelled'), { name: 'AbortError' }));
    const timer = setTimeout(() => fail(new Error(`Docker command timed out after ${timeout}ms`)), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      pending += chunk.toString();
      if (output.length > 20 * 1024 * 1024) return fail(new Error('Worker output limit exceeded'));
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.startsWith('VEAVE_EVENT ')) {
          try { onEvent?.(JSON.parse(line.slice(12))); } catch { /* Final result is authoritative. */ }
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 20 * 1024 * 1024) fail(new Error('Worker output limit exceeded'));
    });
    child.on('error', (error) => { failure = error; });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ code, output });
    });
  });
}

// Installation is the only network-enabled phase. Disallow git/file/URL specs and
// non-registry lockfile URLs so npm cannot fetch code from the host/private network.
function dependencyPolicy(files) {
  const pkg = JSON.parse(files.find((file) => file.path === 'package.json')?.content || '{}');
  const specs = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  for (const [name, version] of Object.entries(specs)) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
        typeof version !== 'string' || !/^[\d\s.^~<>=|*xXv-]+$/.test(version)) {
      throw new Error(`Dependency ${name} must use an explicit npm registry version/range, not a URL, git, file or tag spec.`);
    }
  }
  if (pkg.workspaces) throw new Error('Workspace dependencies require a dedicated runner; this runner supports a single npm project.');
  if (pkg.overrides || pkg.resolutions) throw new Error('Dependency overrides require a dedicated dependency policy.');
  for (const file of files.filter((item) => item.path === 'package-lock.json')) {
    const lock = JSON.parse(file.content);
    const inspect = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'resolved' && typeof entry === 'string') {
          const url = new URL(entry);
          if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) {
            throw new Error('Lockfile downloads must use https://registry.npmjs.org only.');
          }
        } else if (key === 'link' && entry) throw new Error('Linked dependencies are not supported.');
        else inspect(entry);
      }
    };
    inspect(lock);
  }
}

function decodeVisualReference(value) {
  if (typeof value !== 'string') throw new Error('Screenshot reference must be a base64 data URL.');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('Screenshot reference must be a PNG, JPEG, or WebP base64 data URL.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('Screenshot reference must be between 1 byte and 5 MiB.');
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const expected = match[1] === 'image/png' ? png : match[1] === 'image/jpeg' ? jpeg : webp;
  if (!expected) throw new Error('Screenshot reference content does not match its declared image type.');
  return { buffer, mimeType: match[1] };
}

async function executeProject(files, { signal, onEvent, visualReference, visualThreshold } = {}) {
  const paths = validateFilePaths(files);
  if (paths.length) return { ok: false, diagnostics: paths };
  try { dependencyPolicy(files); }
  catch (error) { return { ok: false, blocked: true, diagnostics: [{ category: 'dependency-policy', path: 'package.json', message: error.message }] }; }
  const image = process.env.VEAVE_RUNNER_IMAGE || 'veave-validator:1';
  let directory;
  let referenceDirectory;
  let resourcesCreated = false;
  const name = `veave-validation-${randomUUID()}`;
  const volume = `${name}-files`;
  const network = `${name}-network`;
  const proxy = `${name}-registry`;
  try {
    const available = await docker(['image', 'inspect', image], { signal });
    if (available.code !== 0) throw new Error(`Validation worker unavailable. Start Docker Desktop and run npm run runner:build in backend.\n${available.output}`);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-validation-'));
    for (const file of files) {
      const target = path.join(directory, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await fs.writeFile(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content, { mode: 0o644 });
    }
    if (visualReference) {
      const decoded = decodeVisualReference(visualReference);
      referenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-reference-'));
      await fs.writeFile(path.join(referenceDirectory, 'reference-image'), decoded.buffer, { mode: 0o444 });
    }
    const created = await docker(['volume', 'create', volume], { signal });
    if (created.code !== 0) throw new Error(created.output);
    resourcesCreated = true;
    const net = await docker(['network', 'create', '--internal', network], { signal });
    if (net.code !== 0) throw new Error(net.output);
    const proxyStart = await docker(['run', '-d', '--rm', '--name', proxy, '--network', 'bridge', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=64m', '--pids-limit=32',
      '--entrypoint', 'node', image, '/runner/registryProxy.cjs'], { signal });
    if (proxyStart.code !== 0) throw new Error(proxyStart.output);
    const connected = await docker(['network', 'connect', '--alias', 'registry-proxy', network, proxy], { signal });
    if (connected.code !== 0) throw new Error(connected.output);
    let installed;
    for (const mode of ['install', 'validate']) {
      const args = ['run', '--rm', '--name', name, '--init', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=2g', '--cpus=2', '--pids-limit=256',
        '--shm-size=256m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
        '--tmpfs', '/home/pwuser:rw,nosuid,nodev,size=64m,uid=1000,gid=1000',
        '--mount', `type=volume,source=${volume},target=/workspace`,
        '--network', mode === 'install' ? network : 'none'];
      if (mode === 'install') args.push('--mount', `type=bind,source=${directory},target=/input,readonly`);
      if (mode === 'validate' && referenceDirectory) {
        args.push('--mount', `type=bind,source=${referenceDirectory},target=/reference,readonly`,
          '-e', 'VEAVE_VISUAL_REFERENCE=/reference/reference-image',
          '-e', `VEAVE_VISUAL_THRESHOLD=${visualThreshold || process.env.SCREENSHOT_VISUAL_THRESHOLD || '0.82'}`);
      }
      args.push(image, mode);
      const outcome = await docker(args, { signal, onEvent, timeout: mode === 'install' ? 300000 : 960000 });
      const lines = outcome.output.split('\n').filter((item) => item.startsWith('VEAVE_RESULT '));
      if (lines.length !== 1) throw new Error(`Validation worker returned ${lines.length} result records (exit ${outcome.code}).\n${outcome.output}`);
      const result = JSON.parse(lines[0].slice(13));
      if (typeof result.ok !== 'boolean' || !Array.isArray(result.diagnostics) || !Array.isArray(result.checks)) {
        throw new Error('Invalid worker result schema');
      }
      if (!result.ok || outcome.code !== 0) return { ...result, ok: false };
       const required = mode === 'install'
         ? ['install', 'dependencies']
         : ['syntax', 'build', 'preview', 'browser', ...(referenceDirectory ? ['visual'] : []), 'artifacts'];
      if (required.some((name) => !result.checks.some((check) => check.name === name && check.status === 'passed'))) {
        throw new Error('Worker omitted a required validation stage.');
      }
      if (mode === 'install') installed = result;
      else return { ...result, checks: [...installed.checks, ...result.checks] };
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { ok: false, blocked: true, diagnostics: [{ category: 'infrastructure', path: null, message: error.message }] };
  } finally {
    // Remove by our unique name even if the docker CLI was cancelled or timed out.
    if (resourcesCreated) {
      await docker(['rm', '-f', name, proxy], { timeout: 10000 }).catch(() => {});
      await docker(['volume', 'rm', '-f', volume], { timeout: 10000 }).catch(() => {});
      await docker(['network', 'rm', network], { timeout: 10000 }).catch(() => {});
    }
    if (directory) await fs.rm(directory, { force: true, recursive: true });
    if (referenceDirectory) await fs.rm(referenceDirectory, { force: true, recursive: true });
  }
}

let dockerAvailabilityCache = { available: null, checkedAt: 0 };

async function isDockerAvailable() {
  const now = Date.now();
  if (dockerAvailabilityCache.available !== null && (now - dockerAvailabilityCache.checkedAt) < 15000) {
    return dockerAvailabilityCache.available;
  }
  try {
    const image = process.env.VEAVE_RUNNER_IMAGE || 'veave-validator:1';
    const result = await docker(['image', 'inspect', image], { timeout: 2000 });
    const available = result.code === 0;
    dockerAvailabilityCache = { available, checkedAt: now };
    return available;
  } catch {
    dockerAvailabilityCache = { available: false, checkedAt: now };
    return false;
  }
}

module.exports = { executeProject, dependencyPolicy, isDockerAvailable, decodeVisualReference };
