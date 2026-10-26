const crypto = require('crypto');
const path = require('path');
const parser = require('@babel/parser');

/**
 * Turns one project file into searchable "semantic units" (file, component, function, hook, route, css rule, block).
 * Units carry exact source ranges so the CURRENT text can always be re-read from the authoritative project files; the
 * index only stores a searchable representation, never the source of truth.
 */

const INDEX_VERSION = 3; // bump when unit extraction or the embedding document format changes (forces re-embedding)

const MAX_FILE_BYTES = 300 * 1024;
const MAX_UNIT_TEXT = 6000;
const BLOCK_THRESHOLD = 3500;
const BLOCK_LINES = 40;

const EXCLUDED_PATH = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git|\.next|\.cache|out)\/|(?:^|\/)\.env(?:\.|$)|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|\.min\.(?:js|css)$|\.map$/i;
const CODE_RE = /\.(?:jsx?|tsx?|mjs|cjs)$/i;
const STYLE_RE = /\.(?:css|scss)$/i;
const CONFIG_RE = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|jsconfig\.json|vite\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|src\/tokens\.json)$/i;

const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');

function isIndexable(filePath, file) {
  if (typeof filePath !== 'string' || !filePath || path.isAbsolute(filePath) || filePath.split('/').includes('..')) return false;
  if (EXCLUDED_PATH.test(filePath)) return false;
  if (file && (file.encoding === 'base64' || typeof file.content !== 'string')) return false;
  if (file && Buffer.byteLength(file.content) > MAX_FILE_BYTES) return false;
  return CODE_RE.test(filePath) || STYLE_RE.test(filePath) || /\.(?:html?|json)$/i.test(filePath);
}

// Secrets must never reach search results or embeddings.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
];
const KEYED_SECRET = /((?:api[_-]?key|secret|token|password|passwd|authorization|bearer|client[_-]?secret|private[_-]?key)["'`\s]*[:=]\s*["'`])([^"'`\n]{6,})(["'`])/gi;
function redactSecrets(text) {
  let out = String(text || '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out.replace(KEYED_SECRET, '$1[REDACTED]$3');
}

/** "PublishButton_v2 btn-primary" -> ['publish','button','v2','btn','primary'] (original tokens kept too) */
function tokenize(text) {
  const raw = String(text || '').match(/[A-Za-z][A-Za-z0-9]*|\d+/g) || [];
  const out = [];
  for (const word of raw) {
    const parts = word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/\s+/);
    for (const part of parts) if (part.length >= 2) out.push(part);
    const whole = word.toLowerCase();
    if (parts.length > 1 && whole.length >= 3) out.push(whole);
  }
  return out;
}

const lineStarts = (text) => { const starts = [0]; for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1); return starts; };
const lineOf = (starts, offset) => { let lo = 0; let hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };

function walk(node, visit, skipKeys = SKIP_KEYS) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit, skipKeys); return; }
  if (typeof node.type !== 'string') return;
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (skipKeys.has(key)) continue;
    walk(node[key], visit, skipKeys);
  }
}
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range', 'tokens', 'comments', 'errors']);

const jsxName = (name) => {
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${name.property.name}`;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return '';
};

function stringsIn(node, out = []) {
  walk(node, (n) => {
    if (n.type === 'StringLiteral') out.push(n.value);
    else if (n.type === 'TemplateElement') out.push(n.value.cooked || n.value.raw || '');
  });
  return out;
}

const UI_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'value', 'name', 'id', 'href', 'to']);

/** What a code unit renders, calls and uses, collected from its AST subtree. */
function analyseSubtree(node) {
  const info = { tags: new Set(), classes: new Set(), ui: [], textTags: [], hooks: new Set(), endpoints: new Set(), handlers: new Set(), idents: new Set(), hasJsx: false, links: new Set() };
  walk(node, (n) => {
    switch (n.type) {
      case 'JSXElement': {
        info.hasJsx = true;
        const tag = jsxName(n.openingElement.name);
        if (tag) info.tags.add(tag);
        const text = (n.children || []).filter((c) => c.type === 'JSXText').map((c) => c.value.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        const exprText = (n.children || []).filter((c) => c.type === 'JSXExpressionContainer' && c.expression.type === 'StringLiteral').map((c) => c.expression.value).join(' ');
        const joined = `${text} ${exprText}`.trim();
        if (joined) { info.ui.push(joined); info.textTags.push({ tag, text: joined.slice(0, 160) }); }
        break;
      }
      case 'JSXFragment': info.hasJsx = true; break;
      case 'JSXAttribute': {
        const name = n.name?.name || '';
        if (/^(?:className|class|style)$/.test(name) && n.value) for (const s of stringsIn(n.value)) for (const c of String(s).split(/\s+/)) if (c) info.classes.add(c);
        if (/^on[A-Z]/.test(name) && n.value?.expression?.type === 'Identifier') info.handlers.add(n.value.expression.name);
        if (UI_ATTRS.has(name) && n.value?.type === 'StringLiteral') {
          info.ui.push(n.value.value);
          if (name === 'to' || name === 'href') info.links.add(n.value.value);
        }
        break;
      }
      case 'CallExpression': {
        const callee = n.callee;
        const calleeName = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : '';
        if (/^use[A-Z0-9]/.test(calleeName)) info.hooks.add(calleeName);
        const first = n.arguments[0];
        const urlish = first && (first.type === 'StringLiteral' ? first.value : first.type === 'TemplateLiteral' ? first.quasis.map((q) => q.value.cooked || '').join('{}') : '');
        const looksHttp = calleeName === 'fetch' || (callee.type === 'MemberExpression' && /^(?:get|post|put|patch|delete|request|head)$/.test(calleeName));
        if (looksHttp && typeof urlish === 'string' && /^(?:\/|https?:)/.test(urlish)) info.endpoints.add(urlish);
        break;
      }
      case 'Identifier': if (info.idents.size < 80) info.idents.add(n.name); break;
      default:
    }
    return true;
  });
  return info;
}

function findFunctionNode(node) {
  let found = null;
  walk(node, (n) => {
    if (found) return false;
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') { found = n; return false; }
    return true;
  });
  return found;
}

const basenamePascal = (filePath) => path.basename(filePath, path.extname(filePath)).replace(/(?:^|[-_.\s])([a-z])/g, (_, c) => c.toUpperCase());

function extractJsRoutes(ast) {
  const routes = [];
  walk(ast.program, (n) => {
    if (n.type === 'JSXOpeningElement' && /^(?:Route|PrivateRoute|ProtectedRoute)$/.test(jsxName(n.name))) {
      const attrs = Object.fromEntries((n.attributes || []).filter((a) => a.type === 'JSXAttribute').map((a) => [a.name.name, a.value]));
      const routePath = attrs.path?.type === 'StringLiteral' ? attrs.path.value : (n.attributes || []).some((a) => a.name?.name === 'index') ? '(index)' : null;
      let component = null;
      const el = attrs.element?.expression;
      if (el?.type === 'JSXElement') component = jsxName(el.openingElement.name);
      const comp = attrs.component?.expression || attrs.Component?.expression;
      if (comp?.type === 'Identifier') component = comp.name;
      if (routePath && component) routes.push({ path: routePath, component });
    }
    // Route tables keyed by path: { "/about": AboutPage }, { "/about": { title, Page: AboutPage } } (generated apps, the engine override map).
    if (n.type === 'ObjectProperty' && n.key && n.key.type === 'StringLiteral' && /^\/[\w\-./]*$/.test(n.key.value)) {
      let component = null;
      if (n.value?.type === 'Identifier') component = n.value.name;
      else if (n.value?.type === 'ObjectExpression') {
        const pick = n.value.properties.find((q) => q.type === 'ObjectProperty' && q.key && /^(?:Page|page|Component|component|element)$/.test(q.key.name || q.key.value || ''));
        if (pick?.value?.type === 'Identifier') component = pick.value.name;
        else if (pick?.value?.type === 'JSXElement') component = jsxName(pick.value.openingElement.name);
      }
      if (component && /^[A-Z]/.test(component)) routes.push({ path: n.key.value, component });
    }
    if (n.type === 'ObjectExpression') {
      const props = Object.fromEntries(n.properties.filter((p) => p.type === 'ObjectProperty' && p.key && (p.key.name || p.key.value)).map((p) => [p.key.name || p.key.value, p.value]));
      if (props.path?.type === 'StringLiteral') {
        let component = null;
        if (props.element?.type === 'JSXElement') component = jsxName(props.element.openingElement.name);
        const c = props.Component || props.component;
        if (c?.type === 'Identifier') component = c.name;
        if (component) routes.push({ path: props.path.value, component });
      }
    }
    return true;
  });
  return routes;
}

function chunkBlocks(unit, text, baseLine) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += BLOCK_LINES) {
    const slice = lines.slice(i, i + BLOCK_LINES);
    const blockText = slice.join('\n');
    if (!blockText.trim()) continue;
    blocks.push({ id: `${unit.id}/b${i}`, path: unit.path, kind: 'block', name: unit.name, parent: unit.id, startLine: baseLine + i, endLine: baseLine + i + slice.length - 1, text: blockText.slice(0, MAX_UNIT_TEXT), meta: { classes: [], ui: [], tags: [] } });
  }
  return blocks;
}

function indexJs(filePath, content) {
  const isTs = /\.tsx?$/i.test(filePath);
  let ast;
  let parseError = null;
  try {
    ast = parser.parse(content, { sourceType: 'unambiguous', errorRecovery: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true, plugins: isTs ? ['typescript', 'jsx'] : ['jsx'] });
    if (ast.errors?.length) parseError = ast.errors[0].message;
  } catch (error) {
    // Plain .js that uses TS-only or flow syntax: try once more with the other plugin set before giving up.
    try { ast = parser.parse(content, { sourceType: 'unambiguous', errorRecovery: true, plugins: isTs ? ['jsx'] : ['typescript', 'jsx'] }); } catch { parseError = error.message; }
  }
  if (!ast) return { imports: [], exports: [], units: [], routes: [], parseError, ...regexFallback(filePath, content) };

  const starts = lineStarts(content);
  const imports = [];
  const exportsList = [];
  const units = [];
  const declLocal = new Map(); // local name -> exported as default/named
  let defaultName = null;

  const addUnit = (name, node, exported, isDefault) => {
    const info = analyseSubtree(node);
    const fn = findFunctionNode(node);
    const looksComponent = /^[A-Z]/.test(name) && (info.hasJsx || (fn && info.tags.size > 0));
    let kind = /^use[A-Z0-9]/.test(name) ? 'hook' : looksComponent ? 'component' : node.type === 'ClassDeclaration' ? 'class' : 'function';
    const startLine = lineOf(starts, node.start);
    const endLine = lineOf(starts, Math.max(node.start, node.end - 1));
    const text = content.slice(node.start, node.end);
    const unit = {
      id: `${filePath}#${kind}:${name}:${startLine}`, path: filePath, kind, name, startLine, endLine, exported: Boolean(exported), isDefault: Boolean(isDefault),
      text: text.slice(0, MAX_UNIT_TEXT),
      meta: { tags: [...info.tags].slice(0, 60), classes: [...info.classes].slice(0, 80), ui: info.ui.slice(0, 60), textTags: info.textTags.slice(0, 40), hooks: [...info.hooks], endpoints: [...info.endpoints], handlers: [...info.handlers], idents: [...info.idents], links: [...info.links] }
    };
    units.push(unit);
    if (text.length > BLOCK_THRESHOLD) units.push(...chunkBlocks(unit, text, startLine));
    return unit;
  };

  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') {
      imports.push({ source: stmt.source.value, names: stmt.specifiers.map((s) => ({ local: s.local.name, imported: s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.name || s.imported.value) })) });
      continue;
    }
    let decl = stmt;
    let exported = false;
    let isDefault = false;
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      exported = true;
      isDefault = stmt.type === 'ExportDefaultDeclaration';
      if (stmt.type === 'ExportNamedDeclaration' && !stmt.declaration) {
        for (const s of stmt.specifiers || []) exportsList.push(s.exported.name || s.exported.value);
        if (stmt.source) imports.push({ source: stmt.source.value, names: [], reexport: true });
        continue;
      }
      decl = stmt.declaration;
    }
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
      const name = decl.id?.name || (isDefault ? basenamePascal(filePath) : null);
      if (name) { addUnit(name, stmt, exported, isDefault); if (exported) exportsList.push(isDefault ? 'default' : name); if (isDefault) defaultName = name; }
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier' || !d.init) continue;
        const holdsFn = findFunctionNode(d.init);
        if (!holdsFn && !/^[A-Z]/.test(d.id.name)) continue;
        addUnit(d.id.name, stmt, exported, false);
        if (exported) exportsList.push(d.id.name);
      }
    } else if (isDefault && (decl.type === 'ArrowFunctionExpression' || decl.type === 'FunctionExpression' || decl.type === 'CallExpression')) {
      const name = basenamePascal(filePath);
      addUnit(name, stmt, true, true);
      exportsList.push('default');
      defaultName = name;
    } else if (isDefault && decl.type === 'Identifier') {
      defaultName = decl.name;
      exportsList.push('default');
    }
  }
  if (defaultName) for (const unit of units) if (unit.name === defaultName && unit.kind !== 'block') { unit.isDefault = true; unit.exported = true; }

  const routes = extractJsRoutes(ast);
  for (const route of routes) {
    units.push({ id: `${filePath}#route:${route.path}:${route.component}`, path: filePath, kind: 'route', name: route.path, startLine: 1, endLine: 1, text: `route ${route.path} -> ${route.component}`, meta: { route: route.path, component: route.component, tags: [route.component], classes: [], ui: [] } });
  }
  return { imports, exports: exportsList, units, routes, parseError };
}

// Unparseable file: keep it findable with a regex pass rather than dropping it.
function regexFallback(filePath, content) {
  const starts = lineStarts(content);
  const units = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1] || m[2];
    const offset = m.index + (content[m.index] === '\n' ? 1 : 0);
    const startLine = lineOf(starts, offset);
    const text = content.slice(offset, offset + 1500);
    units.push({ id: `${filePath}#${/^[A-Z]/.test(name) ? 'component' : 'function'}:${name}:${startLine}`, path: filePath, kind: /^[A-Z]/.test(name) ? 'component' : 'function', name, startLine, endLine: Math.min(starts.length, startLine + 30), text, meta: { tags: [], classes: [...text.matchAll(/class(?:Name)?=["']([^"']+)["']/g)].flatMap((x) => x[1].split(/\s+/)), ui: [], textTags: [], hooks: [], endpoints: [], handlers: [], idents: [], links: [] } });
  }
  return { units };
}

function indexCss(filePath, content) {
  const starts = lineStarts(content);
  const units = [];
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  let depth = 0;
  let selStart = 0;
  let atRule = null;
  const stack = [];
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === '{') {
      const header = stripped.slice(selStart, i).trim();
      stack.push({ header, start: selStart, atRule: header.startsWith('@') });
      depth += 1;
      selStart = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      depth -= 1;
      if (open && !open.atRule && open.header) {
        const from = open.start + (stripped.slice(open.start).length - stripped.slice(open.start).trimStart().length);
        const text = content.slice(from, i + 1);
        const classes = [...open.header.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1]);
        const ids = [...open.header.matchAll(/#([A-Za-z_][\w-]*)/g)].map((x) => x[1]);
        const vars = [...text.matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]);
        atRule = stack.map((s) => s.header).find((h) => h.startsWith('@')) || null;
        const startLine = lineOf(starts, from);
        units.push({ id: `${filePath}#css-rule:${open.header.slice(0, 60)}:${startLine}`, path: filePath, kind: 'css-rule', name: open.header.replace(/\s+/g, ' ').slice(0, 120), startLine, endLine: lineOf(starts, i), text: text.slice(0, 1600), meta: { selectors: open.header, classes, ids, vars, atRule, tags: [], ui: [] } });
      }
      selStart = i + 1;
    } else if (ch === ';' && depth === 0) selStart = i + 1;
  }
  return { imports: [...content.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)].map((m) => ({ source: m[1], names: [] })), exports: [], units, routes: [] };
}

function indexHtml(filePath, content) {
  const title = (content.match(/<title[^>]*>([^<]*)</i) || [])[1] || '';
  const headings = [...content.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const classes = [...new Set([...content.matchAll(/class=["']([^"']+)["']/g)].flatMap((m) => m[1].split(/\s+/)))].slice(0, 80);
  const ids = [...content.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]).slice(0, 60);
  return { imports: [...content.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => ({ source: m[1], names: [] })), exports: [], units: [], routes: [], fileMeta: { ui: [title, ...headings].filter(Boolean), classes, ids } };
}

function indexJson(filePath, content) {
  let keys = [];
  try {
    const data = JSON.parse(content);
    if (data && typeof data === 'object') {
      keys = Object.keys(data).slice(0, 60);
      if (/package\.json$/.test(filePath)) keys = [...keys, ...Object.keys(data.dependencies || {}), ...Object.keys(data.devDependencies || {}), ...Object.keys(data.scripts || {})];
      else for (const k of Object.keys(data).slice(0, 20)) if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) keys.push(...Object.keys(data[k]).slice(0, 20));
    }
  } catch { /* malformed json is still a file */ }
  return { imports: [], exports: [], units: [], routes: [], fileMeta: { ui: [], classes: [], keys } };
}

/**
 * @returns {{path,hash,language,units:Array,imports:Array,exports:Array,routes:Array,parseError:?string,lineCount:number}}
 */
function indexFile(filePath, content) {
  const hash = sha(content);
  const lineCount = content.split('\n').length;
  let result;
  let language = 'text';
  try {
    if (CODE_RE.test(filePath)) { language = /\.tsx?$/i.test(filePath) ? 'typescript' : 'javascript'; result = indexJs(filePath, content); }
    else if (STYLE_RE.test(filePath)) { language = 'css'; result = indexCss(filePath, content); }
    else if (/\.html?$/i.test(filePath)) { language = 'html'; result = indexHtml(filePath, content); }
    else { language = 'json'; result = indexJson(filePath, content); }
  } catch (error) {
    result = { imports: [], exports: [], units: [], routes: [], parseError: error.message };
  }
  const units = (result.units || []).map((u) => ({ ...u, text: redactSecrets(u.text) }));
  const fileMeta = result.fileMeta || {};
  const topUnits = units.filter((u) => u.kind !== 'block');
  const file = {
    id: `${filePath}#file`, path: filePath, kind: CONFIG_RE.test(filePath) ? 'config' : 'file', name: path.basename(filePath), startLine: 1, endLine: lineCount, text: redactSecrets(content.slice(0, 1200)),
    meta: {
      tags: [...new Set(topUnits.flatMap((u) => u.meta.tags || []))].slice(0, 60),
      classes: [...new Set([...topUnits.flatMap((u) => u.meta.classes || []), ...(fileMeta.classes || [])])].slice(0, 100),
      ui: [...new Set([...topUnits.flatMap((u) => u.meta.ui || []), ...(fileMeta.ui || [])])].slice(0, 60),
      names: topUnits.map((u) => u.name).slice(0, 40), keys: fileMeta.keys || [], ids: fileMeta.ids || [],
      imports: (result.imports || []).map((i) => i.source), exports: result.exports || []
    }
  };
  return { path: filePath, hash, language, lineCount, units: [file, ...units], imports: result.imports || [], exports: result.exports || [], routes: result.routes || [], parseError: result.parseError || null };
}

/** A natural-language description of a unit (what it is, where it lives, what it renders), used for embeddings. */
function describeUnit(unit) {
  const m = unit.meta || {};
  const pieces = [];
  const words = tokenize(unit.name).join(' ');
  if (unit.kind === 'route') pieces.push(`route ${m.route} renders the ${m.component} page`);
  else if (unit.kind === 'css-rule') pieces.push(`style rule ${unit.name}${m.atRule ? ` inside ${m.atRule}` : ''}${m.vars?.length ? ` defining ${m.vars.join(' ')}` : ''}`);
  else if (unit.kind === 'file' || unit.kind === 'config') pieces.push(`${unit.kind} ${unit.path} containing ${(m.names || []).join(' ')}`);
  else pieces.push(`${unit.kind} ${unit.name} (${words}) in ${unit.path}`);
  if (m.tags?.length) pieces.push(`renders ${m.tags.slice(0, 20).join(' ')}`);
  if (m.ui?.length) pieces.push(`text: ${m.ui.slice(0, 12).join(' | ')}`);
  if (m.classes?.length) pieces.push(`classes: ${m.classes.slice(0, 20).join(' ')}`);
  if (m.hooks?.length) pieces.push(`uses ${m.hooks.join(' ')}`);
  if (m.endpoints?.length) pieces.push(`calls ${m.endpoints.slice(0, 5).join(' ')}`);
  if (m.handlers?.length) pieces.push(`handlers ${m.handlers.slice(0, 6).join(' ')}`);
  if (m.keys?.length) pieces.push(`keys ${m.keys.slice(0, 30).join(' ')}`);
  return redactSecrets(pieces.join('. ')).slice(0, 900);
}

/** Weighted token bag for BM25: names and paths count more than body identifiers. */
function lexicalFields(unit) {
  const m = unit.meta || {};
  const bag = [];
  const push = (tokens, weight) => { for (let i = 0; i < weight; i += 1) bag.push(...tokens); };
  push(tokenize(unit.name), 3);
  push(tokenize(unit.path), 2);
  push(tokenize((m.ui || []).join(' ')), 2);
  push(tokenize((m.classes || []).join(' ')), 2);
  push(tokenize((m.endpoints || []).join(' ')), 2);
  push(tokenize((m.tags || []).join(' ')), 1);
  push(tokenize((m.hooks || []).concat(m.handlers || [], m.names || [], m.keys || [], m.ids || [], m.vars || []).join(' ')), 1);
  push(tokenize((m.idents || []).join(' ')), 1);
  if (unit.kind === 'block' || unit.kind === 'css-rule') push(tokenize(unit.text), 1);
  if (unit.kind === 'route') push(tokenize(`${m.route} ${m.component}`), 2);
  return bag;
}

module.exports = { INDEX_VERSION, indexFile, isIndexable, describeUnit, lexicalFields, tokenize, redactSecrets, sha, MAX_FILE_BYTES };
