const path = require('path').posix;
const babelParser = require('@babel/parser');
const postcss = require('postcss');

const SOURCE_EXTENSIONS = ['.jsx', '.js', '.tsx', '.ts', '.mjs', '.cjs'];
const ASSET_EXTENSIONS = ['.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico'];

function normalizeFilePath(filePath) {
  return path.normalize(String(filePath || '').replace(/\\/g, '/')).replace(/^\.\//, '');
}

function getFileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function validateFilePaths(files) {
  const diagnostics = [];
  const report = (filePath, message) => diagnostics.push({
    category: 'path', path: filePath, line: null, column: null, message
  });
  if (!Array.isArray(files)) {
    report('', 'Project files must be an array.');
    return diagnostics;
  }
  let sourceBytes = 0;
  let binaryBytes = 0;
  const sourceSizes = [];
  const paths = new Set();
  for (const file of files) {
    const filePath = file?.path;
    // Require canonical relative paths; normalizing first would hide traversal.
    if (typeof filePath !== 'string' || !filePath || /[\\\x00-\x1f\x7f<>:"|?*]/.test(filePath)
      || filePath.split('/').some((part) => !part || part === '.' || part === '..'
        || /[. ]$/.test(part) || /^(?:\.env(?:\..*)?|\.npmrc|node_modules|\.git)$/i.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      report(typeof filePath === 'string' ? filePath : '', 'Unsafe project path: use a relative path without traversal, reserved names, or protected files.');
      continue;
    }
    const mode = typeof file.mode === 'string' ? parseInt(file.mode, 8) : file.mode;
    if ((file.type != null && file.type !== 'file') || (file.kind != null && file.kind !== 'file')
      || ['symlink', 'isSymlink', 'isSymbolicLink', 'link', 'linkTarget', 'linkname', 'target'].some((key) => Object.hasOwn(file, key))
      || (mode != null && (mode & 0o170000) !== 0 && (mode & 0o170000) !== 0o100000)) {
      report(filePath, 'Only regular source files are allowed; links are not supported.');
    }
    if (typeof file.content !== 'string') {
      report(filePath, 'File content must be a string.');
    } else {
      if (file.encoding != null && !['utf8', 'base64'].includes(file.encoding)) {
        report(filePath, 'File encoding must be utf8 or base64.');
      } else if (file.encoding === 'base64') {
        const compact = file.content.replace(/\s/g, '');
        if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) report(filePath, 'Binary asset content must be canonical base64.');
        else binaryBytes += Buffer.byteLength(compact, 'base64');
      } else {
        const fileBytes = Buffer.byteLength(file.content, 'utf8');
        sourceBytes += fileBytes;
        sourceSizes.push({ path: filePath, bytes: fileBytes });
      }
    }
    const key = filePath.toLowerCase();
    if (paths.has(key)) report(filePath, 'Duplicate project path.');
    paths.add(key);
  }
  for (const filePath of paths) {
    const parts = filePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (paths.has(parts.slice(0, index).join('/'))) {
        report(filePath, 'A project file cannot also be a directory.');
        break;
      }
    }
  }
  const configuredSourceBytes = Number.parseInt(process.env.MAX_PROJECT_SOURCE_BYTES, 10);
  const configuredBinaryBytes = Number.parseInt(process.env.MAX_PROJECT_BINARY_BYTES, 10);
  const maximumSourceBytes = configuredSourceBytes === 0 ? Infinity : Math.max(1024 * 1024, configuredSourceBytes || 6 * 1024 * 1024);
  const maximumBinaryBytes = configuredBinaryBytes === 0 ? Infinity : Math.max(1024 * 1024, configuredBinaryBytes || 5 * 1024 * 1024);
  if (sourceBytes > maximumSourceBytes) {
    const largest = sourceSizes.sort((a, b) => b.bytes - a.bytes).slice(0, 5)
      .map((item) => `${item.path} (${Math.ceil(item.bytes / 1024)} KiB)`).join(', ');
    report('', `Project source exceeds the limit of ${Math.ceil(maximumSourceBytes / 1024 / 1024)} MB. Largest files: ${largest}.`);
  }
  if (binaryBytes > maximumBinaryBytes) report('', `Localized binary assets exceed the limit of ${Math.ceil(maximumBinaryBytes / 1024 / 1024)} MB.`);
  return diagnostics;
}

function collectDeclarationNames(declaration, target) {
  if (!declaration) return;
  if (declaration.type === 'Identifier') target.add(declaration.name);
  if (declaration.type === 'ObjectPattern') {
    declaration.properties.forEach((item) => collectDeclarationNames(item.type === 'RestElement' ? item.argument : item.value, target));
  }
  if (declaration.type === 'ArrayPattern') declaration.elements.forEach((item) => collectDeclarationNames(item, target));
  if (declaration.type === 'AssignmentPattern') collectDeclarationNames(declaration.left, target);
  if (declaration.type === 'RestElement') collectDeclarationNames(declaration.argument, target);
  if (declaration.id?.name) target.add(declaration.id.name);
  if (declaration.type === 'VariableDeclaration') {
    declaration.declarations.forEach((item) => collectDeclarationNames(item.id, target));
  }
}

function resolveLocalImport(importerPath, source, files) {
  const requestedPath = path.normalize(path.join(path.dirname(importerPath), source));
  if (requestedPath === '..' || requestedPath.startsWith('../')) return null;

  const candidates = [requestedPath];
  // TypeScript permits .js specifiers for source .ts/.tsx modules.
  if (/\.jsx?$/.test(requestedPath)) {
    candidates.push(requestedPath.replace(/\.jsx?$/, '.ts'), requestedPath.replace(/\.jsx?$/, '.tsx'));
  }
  if (!getFileExtension(requestedPath)) {
    SOURCE_EXTENSIONS.concat(ASSET_EXTENSIONS).forEach((extension) => {
      candidates.push(`${requestedPath}${extension}`);
    });
    [...SOURCE_EXTENSIONS, ...ASSET_EXTENSIONS].forEach((extension) => {
      candidates.push(path.join(requestedPath, `index${extension}`));
    });
  }

  return candidates.find((candidate) => files.has(candidate)) || null;
}

function parseSource(file, diagnostics) {
  const extension = getFileExtension(file.path);
  if (!SOURCE_EXTENSIONS.includes(extension)) return null;

  try {
    return babelParser.parse(file.content, {
      sourceType: 'unambiguous',
      sourceFilename: file.path,
      plugins: [
        ...(extension === '.ts' ? [] : ['jsx']),
        ...(['.ts', '.tsx'].includes(extension) ? ['typescript'] : []),
        'decorators-legacy', 'classProperties', 'importAttributes'
      ]
    });
  } catch (error) {
    diagnostics.push({
      category: 'syntax',
      path: file.path,
      line: error.loc?.line || null,
      column: error.loc?.column == null ? null : error.loc.column + 1,
      message: error.message
    });
    return null;
  }
}

function validateGeneratedFiles(sourceFiles) {
  const diagnostics = validateFilePaths(sourceFiles);
  if (diagnostics.length) return diagnostics;
  const files = new Map(sourceFiles.map((file) => [file.path, file]));

  const packageFile = files.get('package.json');
  if (packageFile) {
    try {
      const packageJson = JSON.parse(packageFile.content);
      if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
        throw new Error('The package root must be a JSON object.');
      }
    } catch (error) {
      diagnostics.push({ category: 'dependency', path: 'package.json', line: null, column: null, message: `Invalid package.json: ${error.message}` });
    }
  }

  const appPath = SOURCE_EXTENSIONS.map((extension) => `src/App${extension}`).find((candidate) => files.has(candidate));
  if (!appPath) {
    diagnostics.push({ category: 'entry', path: 'src/App.jsx', line: null, column: null, message: 'React application entry file is missing.' });
  } else {
    const appLines = String(files.get(appPath).content || '').split('\n').length;
    if (appLines > 500) {
      diagnostics.push({
        category: 'architecture',
        path: appPath,
        line: 501,
        column: 1,
        message: `App entry contains ${appLines} lines. Keep App under 500 lines and move major pages and logically independent UI into src/pages and src/components.`
      });
    }
  }

  const configuredSourceFileLimit = Number.parseInt(process.env.MAX_GENERATED_SOURCE_FILE_BYTES, 10);
  const maximumSourceFileBytes = Number.isFinite(configuredSourceFileLimit) && configuredSourceFileLimit > 0
    ? configuredSourceFileLimit
    : 0;
  for (const file of files.values()) {
    if (!maximumSourceFileBytes) break; // no per-file limit unless MAX_GENERATED_SOURCE_FILE_BYTES is set
    if (!SOURCE_EXTENSIONS.includes(getFileExtension(file.path))) continue;
    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > maximumSourceFileBytes) {
      diagnostics.push({
        category: 'architecture',
        path: file.path,
        line: null,
        column: null,
        message: `Source module is ${Math.ceil(bytes / 1024)} KiB, above the ${Math.ceil(maximumSourceFileBytes / 1024)} KiB per-file limit. Split repeated UI or large static data into focused modules.`
      });
    }
  }

  const parsedFiles = new Map();
  for (const file of files.values()) {
    if (file.encoding === 'base64') continue;
    const extension = getFileExtension(file.path);
    // TypeScript accepts JSONC (comments/trailing commas); the installed tsc
    // validates these configs in the execution stage instead of JSON.parse.
    if (extension === '.json' && file.path !== 'package.json' && !/^(?:ts|js)config(?:\.[\w-]+)?\.json$/.test(path.basename(file.path))) {
      try {
        JSON.parse(file.content);
      } catch (error) {
        diagnostics.push({ category: 'syntax', path: file.path, line: null, column: null, message: `Invalid JSON: ${error.message}` });
      }
    } else if (extension === '.css') {
      try {
        postcss.parse(file.content, { from: file.path });
      } catch (error) {
        diagnostics.push({
          category: 'syntax',
          path: file.path,
          line: error.line || null,
          column: error.column || null,
          message: error.reason || error.message
        });
      }
    }

    const ast = parseSource(file, diagnostics);
    if (!ast) continue;

    const exports = new Set();
    const stars = [];
    ast.program.body.forEach((node) => {
      if (node.type === 'ExportAllDeclaration') stars.push(node.source.value);
      if (node.type !== 'ExportDefaultDeclaration' && node.type !== 'ExportNamedDeclaration') return;
      if (node.type === 'ExportDefaultDeclaration') {
        exports.add('default');
        return;
      }
      collectDeclarationNames(node.declaration, exports);
      for (const specifier of node.specifiers || []) {
        if (specifier.exported?.name) exports.add(specifier.exported.name);
        else if (specifier.exported?.value) exports.add(specifier.exported.value);
      }
    });
    parsedFiles.set(file.path, { ast, exports, stars, unknownExports: extension === '.cjs' });
  }

  // Propagate star exports only to barrels affected by each change. Repeatedly
  // scanning every parsed file becomes prohibitively expensive on large projects.
  const starDependents = new Map();
  for (const [filePath, module] of parsedFiles) {
    for (const source of module.stars) {
      const resolved = /^\.{1,2}(?:\/|$)/.test(source) && !/[?#]/.test(source)
        ? resolveLocalImport(filePath, source, files) : null;
      const target = parsedFiles.get(resolved);
      if (!target) {
        module.unknownExports = true;
        continue;
      }
      if (!starDependents.has(resolved)) starDependents.set(resolved, new Set());
      starDependents.get(resolved).add(filePath);
    }
  }

  const exportQueue = [...parsedFiles.keys()];
  const queuedExports = new Set(exportQueue);
  let exportQueueIndex = 0;
  while (exportQueueIndex < exportQueue.length) {
    const targetPath = exportQueue[exportQueueIndex];
    exportQueueIndex += 1;
    queuedExports.delete(targetPath);
    const target = parsedFiles.get(targetPath);
    for (const dependentPath of starDependents.get(targetPath) || []) {
      const dependent = parsedFiles.get(dependentPath);
      let changed = false;
      if (target.unknownExports && !dependent.unknownExports) {
        dependent.unknownExports = true;
        changed = true;
      }
      for (const name of target.exports) {
        if (name !== 'default' && !dependent.exports.has(name)) {
          dependent.exports.add(name);
          changed = true;
        }
      }
      if (changed && !queuedExports.has(dependentPath)) {
        exportQueue.push(dependentPath);
        queuedExports.add(dependentPath);
      }
    }
  }

  if (appPath && parsedFiles.has(appPath) && !parsedFiles.get(appPath).exports.has('default')) {
    diagnostics.push({ category: 'export', path: appPath, line: null, column: null, message: 'The application entry must provide a default React component export.' });
  }

  for (const [filePath, module] of parsedFiles) {
    for (const node of module.ast.program.body) {
      const isImport = node.type === 'ImportDeclaration';
      const isReExport = node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration';
      if (!isImport && !isReExport) continue;
      const source = node.source?.value;
      if (typeof source !== 'string') continue;

      // Bare/absolute specifiers and loader queries require the real build resolver.
      if (/^\.{1,2}(?:\/|$)/.test(source) && !/[?#]/.test(source)) {
        const resolvedPath = resolveLocalImport(filePath, source, files);
        if (!resolvedPath) {
          diagnostics.push({
            category: 'import',
            path: filePath,
            line: node.loc?.start.line || null,
            column: node.loc?.start.column == null ? null : node.loc.start.column + 1,
            message: `Cannot resolve local import "${source}".`,
            relatedPath: source
          });
          continue;
        }

        const importedModule = parsedFiles.get(resolvedPath);
        if (!importedModule || getFileExtension(resolvedPath) === '.cjs') continue;
        for (const specifier of node.specifiers || []) {
          if (specifier.type === 'ImportSpecifier' || specifier.type === 'ExportSpecifier') {
            const name = isImport ? specifier.imported : specifier.local;
            const importedName = name?.name || name?.value;
            if (importedName && !importedModule.exports.has(importedName)
              && !(importedName !== 'default' && importedModule.unknownExports)) {
              diagnostics.push({
                category: 'export',
                path: filePath,
                line: specifier.loc?.start.line || node.loc?.start.line || null,
                column: specifier.loc?.start.column == null ? null : specifier.loc.start.column + 1,
                message: `Import "${importedName}" is not exported by "${resolvedPath}".`,
                relatedPath: resolvedPath
              });
            }
          } else if (specifier.type === 'ImportDefaultSpecifier' && !importedModule.exports.has('default')) {
            diagnostics.push({
              category: 'export',
              path: filePath,
              line: specifier.loc?.start.line || node.loc?.start.line || null,
              column: specifier.loc?.start.column == null ? null : specifier.loc.start.column + 1,
              message: `Default import is not exported by "${resolvedPath}".`,
              relatedPath: resolvedPath
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

function formatDiagnostics(diagnostics) {
  return diagnostics.map((item) => {
    const location = item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '';
    return `${item.path || 'project'}${location} [${item.category}] ${item.message}`;
  }).join('\n');
}

module.exports = { validateGeneratedFiles, validateFilePaths, formatDiagnostics, normalizeFilePath };
