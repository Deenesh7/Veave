/**
 * Stray identifiers: words the model leaks into code positions (outside JSX text and strings), most often fragments
 * in another script such as `сия` or `中文`. They parse as valid identifiers, so syntax checks accept them, but the module
 * throws "X is not defined" the moment it runs. In the preview every module is evaluated, so one such word in one
 * component crashes EVERY route of a multi-page site.
 *
 * Only identifiers that contain non-ASCII characters and are not declared anywhere in the file are flagged: generated
 * code never names its own variables that way, so this has no false positives on real code.
 */
const babelParser = require('@babel/parser');

const NON_ASCII = /[^\x00-\x7f]/;
const SOURCE_FILE = /\.(?:jsx?|tsx?|mjs|cjs)$/i;
// Wrapper expressions that are TypeScript-only but contain real runtime expressions.
const TS_RUNTIME = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);

function parse(filePath, content) {
  const extension = String(filePath).split('.').pop().toLowerCase();
  try {
    return babelParser.parse(content, {
      sourceType: 'unambiguous',
      plugins: [
        ...(extension === 'ts' ? [] : ['jsx']),
        ...(['ts', 'tsx'].includes(extension) ? ['typescript'] : []),
        'decorators-legacy', 'classProperties', 'importAttributes'
      ]
    });
  } catch {
    return null;
  }
}

function isNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

function walk(node, visit, parent = null, key = null) {
  if (!isNode(node)) return;
  if (visit(node, parent, key) === false) return;
  for (const childKey of Object.keys(node)) {
    if (['loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'].includes(childKey)) continue;
    if (['typeAnnotation', 'typeParameters', 'returnType', 'superTypeParameters', 'implements'].includes(childKey)) continue;
    const child = node[childKey];
    if (Array.isArray(child)) child.forEach((item) => walk(item, visit, node, childKey));
    else walk(child, visit, node, childKey);
  }
}

function collectPatternNames(pattern, target) {
  if (!isNode(pattern)) return;
  if (pattern.type === 'Identifier') target.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((item) => collectPatternNames(item.type === 'RestElement' ? item.argument : item.value, target));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((item) => collectPatternNames(item, target));
  else if (pattern.type === 'AssignmentPattern') collectPatternNames(pattern.left, target);
  else if (pattern.type === 'RestElement') collectPatternNames(pattern.argument, target);
  else if (pattern.type === 'TSParameterProperty') collectPatternNames(pattern.parameter, target);
}

function declaredNames(ast) {
  const names = new Set();
  walk(ast.program, (node) => {
    switch (node.type) {
      case 'VariableDeclarator': collectPatternNames(node.id, names); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
      case 'ObjectMethod': case 'ClassMethod': case 'ClassPrivateMethod':
        if (node.id) collectPatternNames(node.id, names);
        (node.params || []).forEach((param) => collectPatternNames(param, names));
        break;
      case 'ClassDeclaration': case 'ClassExpression': if (node.id) names.add(node.id.name); break;
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': if (node.local) names.add(node.local.name); break;
      case 'CatchClause': collectPatternNames(node.param, names); break;
      case 'TSEnumDeclaration': case 'TSModuleDeclaration': if (node.id?.name) names.add(node.id.name); break;
      default: break;
    }
  });
  return names;
}

function isReferencePosition(node, parent, key) {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression': case 'OptionalMemberExpression': return key !== 'property' || parent.computed;
    case 'ObjectProperty': case 'ObjectMethod': case 'ClassMethod': case 'ClassProperty': case 'ClassPrivateProperty': case 'ClassAccessorProperty':
      return key !== 'key' || parent.computed;
    case 'LabeledStatement': case 'BreakStatement': case 'ContinueStatement': return key !== 'label';
    case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': case 'ExportSpecifier': case 'ExportNamespaceSpecifier': case 'ExportDefaultSpecifier':
      return false;
    case 'MetaProperty': return false;
    case 'UnaryExpression': return parent.operator !== 'typeof'; // `typeof x` never throws
    default: return true;
  }
}

/**
 * Finds stray identifiers in parsed code. Returns [{ name, line, column, edit: { start, end, text } }].
 */
function findStrayIdentifiersInAst(ast) {
  if (!ast?.program) return [];
  const declared = declaredNames(ast);
  const found = [];
  walk(ast.program, (node, parent, key) => {
    if (node.type.startsWith('TS') && !TS_RUNTIME.has(node.type)) return false; // type positions are erased
    // `{ сия }` shorthand: the property itself is replaced, its key/value copies are not visited again.
    if (node.type === 'ObjectProperty' && node.shorthand && node.value?.type === 'Identifier' && NON_ASCII.test(node.value.name) && !declared.has(node.value.name)) {
      found.push({ name: node.value.name, line: node.loc?.start.line || null, column: node.loc ? node.loc.start.column + 1 : null, edit: { start: node.start, end: node.end, text: `${JSON.stringify(node.value.name)}: ""` } });
      return false;
    }
    if (node.type !== 'Identifier' || !NON_ASCII.test(node.name) || declared.has(node.name)) return undefined;
    if (!isReferencePosition(node, parent, key)) return undefined;
    let edit = { start: node.start, end: node.end, text: '""' };
    if (parent?.type === 'ExpressionStatement') edit = { start: parent.start, end: parent.end, text: '' };
    else if (parent?.type === 'JSXExpressionContainer') edit = { start: parent.start, end: parent.end, text: '' };
    else if (parent?.type === 'JSXSpreadAttribute' || parent?.type === 'JSXSpreadChild') edit = { start: parent.start, end: parent.end, text: '' };
    else if ((parent?.type === 'CallExpression' || parent?.type === 'OptionalCallExpression') && key === 'callee') edit.text = '(() => "")';
    else if (parent?.type === 'NewExpression' && key === 'callee') edit.text = '(function VeaveStray() {})';
    else if ((parent?.type === 'AssignmentExpression' && key === 'left') || parent?.type === 'UpdateExpression' || (parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') && key === 'left') edit.text = `globalThis[${JSON.stringify(node.name)}]`;
    else if (parent?.type === 'TaggedTemplateExpression' && key === 'tag') edit.text = 'String.raw';
    found.push({ name: node.name, line: node.loc?.start.line || null, column: node.loc ? node.loc.start.column + 1 : null, edit });
    return undefined;
  });
  return found;
}

function findStrayIdentifiers(file) {
  if (!file || file.encoding === 'base64' || typeof file.content !== 'string' || !SOURCE_FILE.test(file.path || '') || !NON_ASCII.test(file.content)) return [];
  return findStrayIdentifiersInAst(parse(file.path, file.content));
}

/** Removes stray identifiers from one source text. Returns { content, names } (content unchanged when nothing safe was found). */
function repairStrayIdentifiersInSource(filePath, content) {
  const strays = findStrayIdentifiers({ path: filePath, content });
  if (!strays.length) return { content, names: [] };
  // Outer edits win over edits nested inside them; edits are applied from the end so offsets stay valid.
  const edits = strays.map((item) => item.edit).sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const edit of edits) {
    const last = kept[kept.length - 1];
    if (last && edit.start < last.end) continue;
    kept.push(edit);
  }
  let next = content;
  for (const edit of kept.reverse()) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  // Never trade a runtime error for a syntax error.
  if (!parse(filePath, next)) return { content, names: [] };
  return { content: next, names: [...new Set(strays.map((item) => item.name))] };
}

/** Repairs every source file of a project. Returns { files, repaired: [{ path, names }] }. */
function repairStrayIdentifiers(files, { paths = null } = {}) {
  const only = paths ? new Set(paths) : null;
  const repaired = [];
  const next = (files || []).map((file) => {
    if (only && !only.has(file?.path)) return file;
    if (!file || file.encoding === 'base64' || typeof file.content !== 'string' || !SOURCE_FILE.test(file.path || '') || !NON_ASCII.test(file.content)) return file;
    const result = repairStrayIdentifiersInSource(file.path, file.content);
    if (!result.names.length) return file;
    repaired.push({ path: file.path, names: result.names });
    return { ...file, content: result.content };
  });
  return { files: next, repaired };
}

module.exports = { findStrayIdentifiers, findStrayIdentifiersInAst, repairStrayIdentifiers, repairStrayIdentifiersInSource };
