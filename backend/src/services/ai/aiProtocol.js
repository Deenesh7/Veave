const path = require('path').posix;
const babelParser = require('@babel/parser');
const postcss = require('postcss');
const {
  AIResponseMalformedError,
  AIResponseValidationError,
  FileApplicationError
} = require('../../utils/errors');

/**
 * Standard structured tool schema for OpenRouter / LLM function calling.
 * Supported by modern OpenAI, Gemini, Claude, and Llama 3 models.
 */
const FILE_OPERATIONS_TOOL = {
  type: 'function',
  function: {
    name: 'apply_project_changes',
    description: 'Apply structured file operations (create, modify, delete, rename, patch) to the project.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'modify'],
          description: 'Overall action being performed'
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of changes'
        },
        files: {
          type: 'array',
          description: 'List of file operations to apply',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative posix path to the file (e.g. src/App.jsx)'
              },
              operation: {
                type: 'string',
                enum: ['create', 'modify', 'delete', 'rename', 'patch'],
                description: 'Operation to perform'
              },
              content: {
                type: 'string',
                description: 'Full file content for create and modify; use an empty string for delete, rename, and patch operations'
              },
              newPath: {
                type: 'string',
                description: 'Destination relative path when operation is rename'
              },
              search: {
                type: 'string',
                description: 'Exact block of text to replace when operation is patch'
              },
              replace: {
                type: 'string',
                description: 'Replacement text when operation is patch'
              }
            },
            required: ['path', 'operation', 'content']
          }
        }
      },
      required: ['action', 'files']
    }
  }
};

/**
 * Deterministic Delimiter Instructions for model prompts when tool calling is not supported.
 * Does not require JSON escaping, making it 100% immune to regex backslash and template literal corruption.
 */
const DELIMITER_INSTRUCTIONS = `
FALLBACK FILE FORMAT:
Output each file modification inside deterministic delimiters:

<FILE path="src/components/Navbar.jsx" operation="modify">
// complete updated file content here verbatim
</FILE>

To create a new file:
<FILE path="src/components/NewComponent.jsx" operation="create">
// file content here
</FILE>

To delete a file:
<FILE path="src/oldFile.jsx" operation="delete" />

To rename a file:
<FILE path="src/OldName.jsx" operation="rename" newPath="src/NewName.jsx" />

To perform a surgical search/replace patch:
<PATCH path="src/App.jsx">
<SEARCH>
exact code to replace
</SEARCH>
<REPLACE>
new code to insert
</REPLACE>
</PATCH>
`.trim();

/**
 * Normalize file objects whether coming from Mongoose Documents or plain JS objects.
 * Guarantees that prototype getters (.path, .content) are never lost during spread operations.
 */
function normalizeFile(f) {
  if (!f) return null;
  const raw = typeof f.toObject === 'function' ? f.toObject() : f;
  const filePath = typeof f.path === 'string' ? f.path : (typeof raw.path === 'string' ? raw.path : '');
  const content = typeof f.content === 'string' ? f.content : (typeof raw.content === 'string' ? raw.content : '');
  const language = typeof f.language === 'string' ? f.language : (typeof raw.language === 'string' ? raw.language : 'javascript');
  const encoding = typeof f.encoding === 'string' ? f.encoding : (typeof raw.encoding === 'string' ? raw.encoding : undefined);
  return {
    path: filePath,
    content,
    language,
    ...(encoding ? { encoding } : {})
  };
}

/**
 * Validate a posix file path for security, directory traversal, and forbidden names.
 */
function validatePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new AIResponseValidationError('Invalid file path: path must be a non-empty string.');
  }

  // Reject absolute paths
  if (filePath.startsWith('/') || filePath.startsWith('\\') || /^[a-zA-Z]:[\\\/]/.test(filePath)) {
    throw new AIResponseValidationError(`Absolute path not allowed: "${filePath}". Only project-relative paths are permitted.`);
  }

  const normalized = path.normalize(filePath.replace(/\\/g, '/')).replace(/^\.\//, '');

  // Reject path traversal
  if (
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..') ||
    normalized === '..' ||
    normalized.includes('..\\')
  ) {
    throw new AIResponseValidationError(`Path traversal detected: "${filePath}". Paths must remain inside project root.`);
  }

  // Reject reserved names and protected files
  const parts = normalized.split('/');
  for (const part of parts) {
    if (
      part === '.env' ||
      part === '.git' ||
      part === 'node_modules' ||
      part === '.npmrc'
    ) {
      throw new AIResponseValidationError(`Modifying protected file or directory is forbidden: "${filePath}".`);
    }
    // Windows reserved device names
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new AIResponseValidationError(`Reserved device name in path: "${filePath}".`);
    }
  }

  // Reject invalid filesystem characters
  if (/[<>:"|?*\x00-\x1f]/.test(normalized)) {
    throw new AIResponseValidationError(`Invalid characters detected in path: "${filePath}".`);
  }

  return normalized;
}

/**
 * In-memory syntax validation for generated or repaired source code.
 * Ensures that no syntax error is written to files or passed down the pipeline.
 */
function validateSourceSyntax(filePath, content) {
  if (typeof content !== 'string') return;
  const ext = path.extname(filePath).toLowerCase();

  if (['.jsx', '.js', '.mjs', '.cjs'].includes(ext)) {
    try {
      babelParser.parse(content, {
        sourceType: 'unambiguous',
        sourceFilename: filePath,
        plugins: ['jsx', 'decorators-legacy', 'classProperties', 'importAttributes']
      });
    } catch (err) {
      const loc = err.loc ? ` (${err.loc.line}:${err.loc.column})` : '';
      throw new FileApplicationError(`Syntax error in "${filePath}"${loc}: ${err.message}`);
    }
  } else if (['.tsx', '.ts'].includes(ext)) {
    try {
      babelParser.parse(content, {
        sourceType: 'unambiguous',
        sourceFilename: filePath,
        plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'importAttributes']
      });
    } catch (err) {
      const loc = err.loc ? ` (${err.loc.line}:${err.loc.column})` : '';
      throw new FileApplicationError(`Syntax error in "${filePath}"${loc}: ${err.message}`);
    }
  } else if (ext === '.json') {
    try {
      JSON.parse(content);
    } catch (err) {
      throw new FileApplicationError(`Invalid JSON in "${filePath}": ${err.message}`);
    }
  } else if (ext === '.css') {
    try {
      postcss.parse(content, { from: filePath });
    } catch (err) {
      throw new FileApplicationError(`CSS syntax error in "${filePath}": ${err.message}`);
    }
  }
}

/**
 * Clean and sanitize patch search/replace blocks.
 * Strips accidental markdown fences, UTF-8 BOM, and zero-width spaces.
 */
function sanitizePatchBlock(str) {
  if (typeof str !== 'string') return '';
  let s = str.replace(/^\uFEFF/, '').replace(/^[\u200B\u200C\u200D\u200E\u200F]+/, '').replace(/[\u200B\u200C\u200D\u200E\u200F]+$/, '');
  const fence = s.trim().match(/^```(?:jsx?|tsx?|javascript|typescript|css|html)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1];
  return s.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/**
 * Sanitize source code extracted from AI responses before validation or application.
 * Strips outer markdown fences, accidental delimiter wrappers, UTF-8 BOM, and conversational preamble.
 */
function sanitizeSourceCode(filePath, content) {
  if (typeof content !== 'string') return '';
  let str = content;

  // 1. Strip UTF-8 BOM and leading/trailing zero-width spaces
  str = str.replace(/^\uFEFF/, '').replace(/^[\u200B\u200C\u200D\u200E\u200F]+/, '').replace(/[\u200B\u200C\u200D\u200E\u200F]+$/, '');

  // 2. Extract code block if wrapped in markdown fences or conversational preambles
  const trimmed = str.trim();
  const fenceMatch = trimmed.match(/^```(?:jsx?|tsx?|javascript|typescript|react|css|json|html)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    str = fenceMatch[1];
  } else {
    // Check if there is a fence embedded after conversational text like "Here is the code: ```jsx ... ```"
    const embeddedFence = trimmed.match(/(?:here is|below is|updated|fixed|sure|certainly|component)[^`]*```(?:jsx?|tsx?|javascript|typescript|react|css|json|html)?\s*\n?([\s\S]*?)\n?```/i);
    if (embeddedFence) {
      str = embeddedFence[1];
    } else {
      // Strip any dangling outer fences
      str = str.replace(/^```(?:jsx?|tsx?|javascript|typescript|react|css|json|html)?\s*\n?/i, '')
               .replace(/\n?```\s*$/i, '');
    }
  }

  // 3. Strip accidental <FILE> / </FILE> tags if trapped in content
  str = str.replace(/^<FILE[^>]*>\s*\n?/i, '').replace(/\n?<\/FILE>\s*$/i, '');

  // 4. Strip conversational preamble if no fences were used
  if (/\.(?:jsx?|tsx?)$/.test(filePath)) {
    const codeStartRegex = /^(?:import\s|export\s|\/\*|\/\/|const\s|function\s|class\s|let\s|var\s|'use strict'|"use strict")/m;
    const match = codeStartRegex.exec(str);
    if (match && match.index > 0) {
      const preamble = str.slice(0, match.index).trim();
      // If preamble does not look like JS code:
      if (!preamble.includes(';') && !preamble.includes('{') && !preamble.includes('}')) {
        str = str.slice(match.index);
      }
    }
  }

  // A response truncated around a markdown fence can leave part of "json"
  // before an otherwise valid document. Recover only a fully parseable value.
  if (/\.json$/i.test(filePath)) {
    const candidate = str.trim();
    try {
      JSON.parse(candidate);
    } catch {
      const objectStart = candidate.indexOf('{');
      const arrayStart = candidate.indexOf('[');
      const starts = [objectStart, arrayStart].filter((index) => index >= 0);
      const start = starts.length ? Math.min(...starts) : -1;
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
      if (start >= 0 && end > start) {
        const enclosed = candidate.slice(start, end + 1);
        try {
          JSON.parse(enclosed);
          str = enclosed;
        } catch {}
      }
    }
  }

  return str.trimEnd() + '\n';
}

function extractResponseText(responseInput) {
  if (typeof responseInput === 'string') return responseInput.trim();

  const value = responseInput?.content || responseInput?.reasoning || '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => typeof part === 'string' ? part : (part?.text || part?.content || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function hasCompleteStructuredResponse(responseInput) {
  const toolCalls = Array.isArray(responseInput?.tool_calls)
    ? responseInput.tool_calls
    : responseInput?.tool_call
      ? [responseInput.tool_call]
      : [];
  if (toolCalls.length) {
    return toolCalls.every((call) => {
      const args = call.function?.arguments || call.arguments;
      try {
        const parsed = typeof args === 'string' ? JSON.parse(args) : args;
        return parsed && Array.isArray(parsed.files) && parsed.files.length > 0;
      } catch {
        return false;
      }
    });
  }

  const text = extractResponseText(responseInput);
  if (!text) return false;
  const patchOpen = (text.match(/<PATCH\b/gi) || []).length;
  const patchClose = (text.match(/<\/PATCH>/gi) || []).length;
  const fileOpen = (text.match(/<FILE\b/gi) || []).length;
  const fileClose = (text.match(/<\/FILE>/gi) || []).length + (text.match(/<FILE\b[^>]*\/>/gi) || []).length;
  if (patchOpen || fileOpen) {
    return patchOpen === patchClose && fileOpen === fileClose && /<\/(?:PATCH|FILE)>\s*$|<FILE\b[^>]*\/>\s*$/i.test(text);
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed?.files) && parsed.files.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

function appendResponseContinuation(existing, continuation) {
  const current = String(existing || '');
  const next = String(continuation || '');
  if (!next) return current;
  const maximum = Math.min(current.length, next.length, 16000);
  for (let overlap = maximum; overlap >= 8; overlap--) {
    if (current.endsWith(next.slice(0, overlap))) return current + next.slice(overlap);
  }
  return current + next;
}

function parseTagAttributes(tag) {
  const attributes = {};
  const attributeRegex = /([a-zA-Z][\w-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = attributeRegex.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

/**
 * Deterministic AI Response Parser.
 * Order of parsing:
 * 1. Tool calls (direct JSON from function calling engine)
 * 2. Deterministic <FILE> and <PATCH> delimiters (raw code preservation without JSON string escaping)
 * 3. Clean JSON object (if response is standard structured JSON)
 * 4. Markdown code blocks with file headers
 * 5. Bare React code fallback
 */
function parseAIResponse(responseInput, defaultTarget = null) {
  if (!responseInput) {
    throw new AIResponseMalformedError('AI returned an empty response.');
  }

  const operations = [];
  let action = 'update';
  let reason = '';

  // 0. Direct parsed object with files array
  if (typeof responseInput === 'object' && responseInput !== null && !Array.isArray(responseInput)) {
    if (Array.isArray(responseInput.files) && responseInput.files.length > 0) {
      return {
        action: responseInput.action || 'update',
        reason: responseInput.reason || '',
        files: responseInput.files
      };
    }
  }

  // 1. Tool Call Parsing (OpenRouter tool_calls)
  let toolCalls = null;
  if (typeof responseInput === 'object' && !Array.isArray(responseInput)) {
    if (Array.isArray(responseInput.tool_calls) && responseInput.tool_calls.length > 0) {
      toolCalls = responseInput.tool_calls;
    } else if (responseInput.tool_call) {
      toolCalls = [responseInput.tool_call];
    }
  } else if (Array.isArray(responseInput)) {
    toolCalls = responseInput;
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const call of toolCalls) {
      const argsRaw = call.function?.arguments || call.arguments;
      if (!argsRaw) continue;
      try {
        const parsedArgs = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;
        if (parsedArgs && Array.isArray(parsedArgs.files)) {
          action = parsedArgs.action || action;
          reason = parsedArgs.reason || reason;
           for (const item of parsedArgs.files) {
             if (item && typeof item.path === 'string') {
               const cleaned = { ...item };
               const alternateContent = cleaned.fileContent ?? cleaned.source ?? cleaned.code;
               if (typeof cleaned.content !== 'string' && typeof alternateContent === 'string') cleaned.content = alternateContent;
               if ((cleaned.operation === 'modify' || !cleaned.operation) && typeof cleaned.content !== 'string' &&
                   typeof cleaned.search === 'string' && typeof cleaned.replace === 'string') {
                 cleaned.operation = 'patch';
               }
               if (typeof cleaned.content === 'string') cleaned.content = sanitizeSourceCode(cleaned.path, cleaned.content);
              if (typeof cleaned.search === 'string') cleaned.search = sanitizePatchBlock(cleaned.search);
              if (typeof cleaned.replace === 'string') cleaned.replace = sanitizePatchBlock(cleaned.replace);
              operations.push(cleaned);
            }
          }
        }
      } catch (err) {
        // Fall through to text parsing if tool call arguments failed to parse
      }
    }
    if (operations.length > 0) {
      return { action, reason, files: operations };
    }
  }

  const rawText = extractResponseText(responseInput);

  if (!rawText) {
    throw new AIResponseMalformedError('AI returned empty content.');
  }

  // 2. Deterministic <FILE> and <PATCH> delimiters (Highest fidelity for raw code)
  const patchRegex = /<PATCH\s+path=["']([^"']*)["']\s*>([\s\S]*?)<\/PATCH>/gi;
  let patchMatch;
  while ((patchMatch = patchRegex.exec(rawText)) !== null) {
    const filePath = patchMatch[1].trim();
    const body = patchMatch[2];
    const searchMatch = body.match(/<SEARCH>([\s\S]*?)<\/SEARCH>/i);
    const replaceMatch = body.match(/<REPLACE>([\s\S]*?)<\/REPLACE>/i);
    if (searchMatch && replaceMatch) {
      operations.push({
        path: filePath,
        operation: 'patch',
        search: sanitizePatchBlock(searchMatch[1]),
        replace: sanitizePatchBlock(replaceMatch[1])
      });
    }
  }

  const fileRegex = /<FILE\b([^>]*?)(?:\/>|>([\s\S]*?)<\/FILE>)/gi;
  let fileMatch;
  while ((fileMatch = fileRegex.exec(rawText)) !== null) {
    const attributes = parseTagAttributes(fileMatch[1]);
    if (!attributes.path) continue;
    const filePath = attributes.path.trim();
    const op = (attributes.operation || 'modify').toLowerCase().trim();
    const newPath = attributes.newpath ? attributes.newpath.trim() : undefined;
    const content = sanitizeSourceCode(filePath, fileMatch[2] || '');

    if (op === 'delete' || op === 'remove') {
      operations.push({ path: filePath, operation: 'delete' });
    } else if (op === 'rename') {
      operations.push({ path: filePath, operation: 'rename', newPath: newPath || filePath, content });
    } else {
      operations.push({
        path: filePath,
        operation: op === 'create' ? 'create' : 'modify',
        content
      });
    }
  }

  if (operations.length > 0) {
    return { action: 'update', reason: 'Parsed from deterministic delimiters', files: operations };
  }

  // 3. Clean JSON object parsing (standard JSON output without backslash distortion)
  let parsedJson = null;
  let jsonString = rawText;

  // Unpack markdown JSON code blocks if present
  const jsonBlock = rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i) ||
                    rawText.match(/```(?:json)?\s*(\{\s*[\s\S]*?\})\s*```/i);
  if (jsonBlock) {
    jsonString = jsonBlock[1].trim();
  }

  if (jsonString.startsWith('{') && jsonString.endsWith('}')) {
    try {
      parsedJson = JSON.parse(jsonString);
    } catch (_) {
      // If direct parse fails, try extracting the clean outer JSON without destructive regex replacements
      const first = jsonString.indexOf('{');
      const last = jsonString.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try {
          parsedJson = JSON.parse(jsonString.slice(first, last + 1));
        } catch (_) {}
      }
    }
  }

  if (parsedJson && typeof parsedJson === 'object') {
    action = parsedJson.action || 'update';
    reason = parsedJson.reason || '';

    const list = Array.isArray(parsedJson.files)
      ? parsedJson.files
      : Array.isArray(parsedJson.actions)
      ? parsedJson.actions
      : parsedJson.path && (parsedJson.content || parsedJson.search)
      ? [parsedJson]
      : [];

    for (const item of list) {
      if (!item || typeof item.path !== 'string') continue;
      const op = String(item.operation || item.action || (item.search ? 'patch' : 'modify')).toLowerCase();

      if (op === 'patch' && typeof item.search === 'string' && typeof item.replace === 'string') {
        operations.push({
          path: item.path,
          operation: 'patch',
          search: sanitizePatchBlock(item.search),
          replace: sanitizePatchBlock(item.replace)
        });
      } else if (op === 'delete' || op === 'remove') {
        operations.push({ path: item.path, operation: 'delete' });
      } else if (op === 'rename') {
        operations.push({
          path: item.path,
          operation: 'rename',
          newPath: item.newPath || item.targetPath,
          content: typeof item.content === 'string' ? sanitizeSourceCode(item.path, item.content) : ''
        });
      } else if (typeof item.content === 'string') {
        operations.push({
          path: item.path,
          operation: op === 'create' ? 'create' : 'modify',
          content: sanitizeSourceCode(item.path, item.content)
        });
      }
    }

    if (operations.length > 0) {
      return { action, reason, files: operations };
    }
  }

  // 4. Markdown File Header Blocks (e.g. `### src/App.jsx\n```jsx ... ```)
  const headerBlockRegex = /(?:###?\s*[`"']?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)[`"']?|File:\s*[`"']?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)[`"']?)\s*```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```/gi;
  let headerMatch;
  while ((headerMatch = headerBlockRegex.exec(rawText)) !== null) {
    const filePath = (headerMatch[1] || headerMatch[2]).trim();
    const content = sanitizeSourceCode(filePath, headerMatch[3].trim());
    if (filePath && content) {
      operations.push({ path: filePath, operation: 'modify', content });
    }
  }
  if (operations.length > 0) {
    return { action: 'update', reason: 'Parsed from markdown file blocks', files: operations };
  }

  // 5. Bare React code fallback
  let bareCode = rawText;
  const singleFence = rawText.match(/```(?:jsx?|tsx?|javascript|typescript|css|html)?\s*([\s\S]*?)\s*```/i);
  if (singleFence) bareCode = singleFence[1].trim();

  const targetPath = defaultTarget || 'src/App.jsx';
  bareCode = sanitizeSourceCode(targetPath, bareCode);

  if (bareCode && (
    bareCode.includes('export default') ||
    bareCode.includes('import React') ||
    bareCode.includes('function App') ||
    bareCode.includes('const App =') ||
    (bareCode.includes('return (') && bareCode.includes('</div>'))
  )) {
    try {
      validateSourceSyntax(targetPath, bareCode);
      return {
        action: 'update',
        reason: 'Extracted direct React component code',
        files: [{ path: targetPath, operation: 'modify', content: bareCode }]
      };
    } catch (_) {
      // If bare code fallback fails syntax validation, do not accept as valid React
    }
  }

  throw new AIResponseMalformedError('AI response could not be parsed into valid file operations. Expected structured output or <FILE> delimiters.');
}

/**
 * Validate parsed file operations according to Requirement 4.
 * Throws AIResponseValidationError with exact diagnostic message if invalid.
 */
function validateFileOperations(parsedResponse, existingFiles = []) {
  if (!parsedResponse || typeof parsedResponse !== 'object') {
    throw new AIResponseValidationError('Invalid response: response must be an object.');
  }

  if (!Array.isArray(parsedResponse.files) || parsedResponse.files.length === 0) {
    throw new AIResponseValidationError('AI response contained no file operations.');
  }

  const seenPaths = new Map();
  const validatedOperations = [];

  for (let i = 0; i < parsedResponse.files.length; i++) {
    const op = parsedResponse.files[i];
    if (!op || typeof op !== 'object') {
      throw new AIResponseValidationError(`File operation at index ${i} is not a valid object.`);
    }

    // 1. Validate Path
    const safePath = validatePath(op.path);

    // 2. Duplicate path detection
    const operation = String(op.operation || 'modify').toLowerCase().trim();
    const previousOperation = seenPaths.get(safePath);
    if (previousOperation && (previousOperation !== 'patch' || operation !== 'patch')) {
      throw new AIResponseValidationError(`Duplicate file path in operations: "${safePath}". Each file can only be modified once per response.`);
    }
    seenPaths.set(safePath, operation);

    // 3. Validate Operation
    const validOperations = ['create', 'modify', 'delete', 'rename', 'patch'];
    if (!validOperations.includes(operation)) {
      throw new AIResponseValidationError(`Unsupported file operation "${operation}" on "${safePath}". Valid operations: ${validOperations.join(', ')}.`);
    }

    // 4. Validate Content requirements
    if (operation === 'create' || operation === 'modify') {
      if (typeof op.content !== 'string') {
        throw new AIResponseValidationError(`Operation "${operation}" on "${safePath}" requires a string "content" field.`);
      }
    } else if (operation === 'patch') {
      if (typeof op.search !== 'string' || typeof op.replace !== 'string') {
        throw new AIResponseValidationError(`Patch operation on "${safePath}" requires "search" and "replace" string fields.`);
      }
      if (!op.search.trim()) {
        throw new AIResponseValidationError(`Patch operation on "${safePath}" has empty search target.`);
      }
    } else if (operation === 'rename') {
      if (!op.newPath || typeof op.newPath !== 'string') {
        throw new AIResponseValidationError(`Rename operation on "${safePath}" requires a non-empty "newPath" string.`);
      }
      const safeNewPath = validatePath(op.newPath);
      if (safeNewPath === safePath) {
        throw new AIResponseValidationError(`Rename source and destination are identical: "${safePath}".`);
      }
    }

    validatedOperations.push({
      ...op,
      path: safePath,
      operation,
      newPath: op.newPath ? validatePath(op.newPath) : undefined
    });
  }

  return {
    valid: true,
    action: parsedResponse.action || 'update',
    reason: parsedResponse.reason || '',
    files: validatedOperations
  };
}

/**
 * Safely apply validated operations to an array of existing project files.
 * Atomically prepares the new file list in memory.
 * If any patch or operation fails, throws FileApplicationError and leaves existingFiles unchanged.
 */
function applyOperationsSafely(existingFiles = [], rawOperations = []) {
  if (!Array.isArray(existingFiles)) {
    throw new FileApplicationError('Existing files must be an array.');
  }

  // Pre-validate response operations
  const validationResult = validateFileOperations({ files: rawOperations }, existingFiles);
  const operations = validationResult.files;

  // Normalize existing files (Mongoose subdocs safe)
  const normalizedExisting = existingFiles.map(normalizeFile).filter(f => f && f.path);
  const fileMap = new Map(normalizedExisting.map(f => [f.path, { ...f }]));
  const modifiedPaths = new Set();

  for (const op of operations) {
    const { path: safePath, operation } = op;

    if (operation === 'patch') {
      const existing = fileMap.get(safePath);
      if (!existing) {
        throw new FileApplicationError(`Patch target file not found in project: "${safePath}".`);
      }

      const cleanSearch = sanitizePatchBlock(op.search);
      const cleanReplace = sanitizePatchBlock(op.replace);

      const normContent = existing.content.replace(/\r\n/g, '\n');
      const normSearch = cleanSearch.replace(/\r\n/g, '\n');
      const normReplace = cleanReplace.replace(/\r\n/g, '\n');

      // Count occurrences of normSearch in normContent
      let matchCount = 0;
      let firstIndex = -1;
      let pos = 0;
      while ((pos = normContent.indexOf(normSearch, pos)) !== -1) {
        if (matchCount === 0) firstIndex = pos;
        matchCount++;
        pos += normSearch.length;
      }

      let newContent = null;

      if (matchCount === 1) {
        newContent = normContent.slice(0, firstIndex) + normReplace + normContent.slice(firstIndex + normSearch.length);
      } else if (matchCount > 1) {
        throw new FileApplicationError(
          `Patch failed: search block matched ${matchCount} locations in "${safePath}". Patch search blocks must be uniquely identifiable (expectedMatches: 1). Add more surrounding context.`
        );
      } else {
        // matchCount === 0: Try flexible line-by-line whitespace matching fallback
        const normLines = normContent.split('\n');
        const searchLines = normSearch.split('\n');
        const matchingIndices = [];

        for (let i = 0; i <= normLines.length - searchLines.length; i++) {
          let matched = true;
          for (let j = 0; j < searchLines.length; j++) {
            if (normLines[i + j].trimEnd() !== searchLines[j].trimEnd() &&
                normLines[i + j].trim() !== searchLines[j].trim()) {
              matched = false;
              break;
            }
          }
          if (matched) {
            matchingIndices.push(i);
          }
        }

        if (matchingIndices.length === 1) {
          const matchIndex = matchingIndices[0];
          const replaceLines = normReplace.split('\n');
          normLines.splice(matchIndex, searchLines.length, ...replaceLines);
          newContent = normLines.join('\n');
        } else if (matchingIndices.length > 1) {
          throw new FileApplicationError(
            `Patch failed: search block matched ${matchingIndices.length} locations in "${safePath}". Patch search blocks must be uniquely identifiable (expectedMatches: 1). Add more surrounding context.`
          );
        } else {
          throw new FileApplicationError(`Patch search block not found in "${safePath}". Existing file was preserved.`);
        }
      }

      // In-Memory Syntax Validation
      validateSourceSyntax(safePath, newContent);
      existing.content = newContent;
      modifiedPaths.add(safePath);

    } else if (operation === 'modify') {
      const cleanContent = sanitizeSourceCode(safePath, op.content);
      validateSourceSyntax(safePath, cleanContent);

      const existing = fileMap.get(safePath);
      if (!existing) {
        // If file doesn't exist, create it cleanly
        fileMap.set(safePath, {
          path: safePath,
          content: cleanContent,
          language: safePath.endsWith('.css') ? 'css' : safePath.endsWith('.json') ? 'json' : 'javascript'
        });
      } else {
        existing.content = cleanContent;
      }
      modifiedPaths.add(safePath);

    } else if (operation === 'create') {
      const cleanContent = sanitizeSourceCode(safePath, op.content);
      validateSourceSyntax(safePath, cleanContent);

      fileMap.set(safePath, {
        path: safePath,
        content: cleanContent,
        language: safePath.endsWith('.css') ? 'css' : safePath.endsWith('.json') ? 'json' : 'javascript'
      });
      modifiedPaths.add(safePath);

    } else if (operation === 'delete') {
      if (fileMap.has(safePath)) {
        fileMap.delete(safePath);
        modifiedPaths.add(safePath);
      }

    } else if (operation === 'rename') {
      const existing = fileMap.get(safePath);
      if (!existing) {
        throw new FileApplicationError(`Cannot rename: source file "${safePath}" not found.`);
      }
      const newPath = op.newPath;
      const content = typeof op.content === 'string' && op.content.length > 0 ? op.content : existing.content;
      fileMap.delete(safePath);
      fileMap.set(newPath, {
        path: newPath,
        content,
        language: newPath.endsWith('.css') ? 'css' : newPath.endsWith('.json') ? 'json' : 'javascript'
      });
      modifiedPaths.add(safePath);
      modifiedPaths.add(newPath);
    }
  }

  // Preserve exact original files that were untouched
  const resultFiles = [];
  for (const orig of normalizedExisting) {
    if (modifiedPaths.has(orig.path)) {
      if (fileMap.has(orig.path)) {
        resultFiles.push(fileMap.get(orig.path));
      }
    } else {
      resultFiles.push(orig); // Exact preservation
    }
  }

  // Add newly created or renamed files
  for (const [p, fileObj] of fileMap.entries()) {
    if (!normalizedExisting.some(f => f.path === p)) {
      resultFiles.push(fileObj);
    }
  }

  return {
    files: resultFiles,
    changedFiles: Array.from(modifiedPaths)
  };
}

/**
 * Validate minimal diff between before and after files.
 * Protects unrelated components from being mutated.
 */
function validateMinimalDiff(beforeFiles = [], afterFiles = [], targetFiles = [], prompt = '') {
  const p = String(prompt || '').toLowerCase();
  const changedPaths = [];

  const beforeNorm = beforeFiles.map(normalizeFile).filter(f => f && f.path);
  const afterNorm = afterFiles.map(normalizeFile).filter(f => f && f.path);
  const targetNorm = targetFiles.map(normalizeFile).filter(f => f && f.path);

  const beforeMap = new Map(beforeNorm.map(f => [f.path, f.content]));
  const afterMap = new Map(afterNorm.map(f => [f.path, f.content]));

  for (const [filePath, afterContent] of afterMap.entries()) {
    const beforeContent = beforeMap.get(filePath);
    if (beforeContent === undefined || beforeContent !== afterContent) {
      changedPaths.push(filePath);
    }
  }
  for (const filePath of beforeMap.keys()) {
    if (!afterMap.has(filePath)) {
      changedPaths.push(filePath);
    }
  }

  if (changedPaths.length === 0) {
    return { valid: false, message: 'No changes were made to the project files.' };
  }

  const targetPaths = new Set(targetNorm.map(f => f.path));

  // Targeted component protection rules
  if (/navbar|header|nav\b/i.test(p) && !/footer|hero|pricing|login|about/i.test(p)) {
    const unrelated = changedPaths.filter(cp =>
      /footer|hero|pricing|login|about|card/i.test(cp) && !targetPaths.has(cp)
    );
    if (unrelated.length > 0) {
      return {
        valid: false,
        message: `Overly broad modification: user asked to change navbar, but unrelated components were modified: ${unrelated.join(', ')}.`
      };
    }
  }

  if (/login\s+button/i.test(p) && !/navbar|hero|footer/i.test(p)) {
    const unrelated = changedPaths.filter(cp =>
      /hero|footer|pricing/i.test(cp) && !targetPaths.has(cp)
    );
    if (unrelated.length > 0) {
      return {
        valid: false,
        message: `Overly broad modification: user asked to change login button, but unrelated components were modified: ${unrelated.join(', ')}.`
      };
    }
  }

  return { valid: true, changedPaths };
}

/**
 * Build unified repair prompt using the SAME structured/delimiter protocol.
 */
function buildRepairPrompt({ files, diagnostics, history = [], targetPath = null, mode = 'structured' }) {
  const diagList = Array.isArray(diagnostics) ? diagnostics : [];
  const errors = diagList.length > 0
    ? diagList.map(d => `[${d.category || 'error'}] ${d.path ? d.path + ': ' : ''}${d.message}`).join('\n')
    : String(diagnostics || '');

  const errorPaths = new Set(diagList.map(d => d.path).filter(Boolean));
  if (targetPath) errorPaths.add(targetPath);

  let relevantFiles = files.filter(f => f && f.path && f.path !== 'package-lock.json');
  if (errorPaths.size > 0) {
    const targeted = relevantFiles.filter(f => errorPaths.has(f.path));
    if (targeted.length > 0) relevantFiles = targeted;
  }

  let errorContext = '';
  const firstError = diagList.find(d => d.line && d.path);
  if (firstError) {
    const targetFile = files.find(f => f.path === firstError.path);
    if (targetFile && typeof targetFile.content === 'string') {
      const lines = targetFile.content.split('\n');
      const errLine = firstError.line;
      const start = Math.max(0, errLine - 15);
      const end = Math.min(lines.length, errLine + 15);
      const excerpt = lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
      errorContext = `\nERROR LOCATION EXCERPT (${firstError.path} lines ${start + 1}-${end}):\n${excerpt}\n`;
    }
  }

  const systemPrompt = `You are an expert React code repair agent.
Your mission is to resolve the exact reported errors without introducing regressions, breaking styling, or deleting features.
CRITICAL: Never remove working components or weaken validation/tests to hide errors.
${DELIMITER_INSTRUCTIONS}
Always prefer outputting either structured tool arguments or <FILE path="...">...</FILE> or <PATCH path="...">...</PATCH> delimiters.`;

  const userMessage = `PROJECT REPAIR REQUEST:
Errors to fix:
${errors}
${errorContext}
Previous failed repair attempts (DO NOT repeat these mistakes):
${JSON.stringify(history)}

Project files:
${relevantFiles.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}

INSTRUCTIONS:
1. Fix the reported errors cleanly.
2. Existing files MUST use surgical <PATCH path="..."> with exact <SEARCH> and <REPLACE> matching 1 location. Never return a complete existing file. Use <FILE> only to create a genuinely new file.
3. NEVER put markdown code fences (\`\`\`) inside the <FILE> or <PATCH> tags.
4. NEVER return conversational preamble, explanations, or notes.
5. Return ONLY the files that need modification.
6. Preserve all other files and functionality.`;

  return {
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    tools: [FILE_OPERATIONS_TOOL]
  };
}

module.exports = {
  FILE_OPERATIONS_TOOL,
  DELIMITER_INSTRUCTIONS,
  normalizeFile,
  validatePath,
  hasCompleteStructuredResponse,
  appendResponseContinuation,
  parseAIResponse,
  validateFileOperations,
  applyOperationsSafely,
  validateMinimalDiff,
  buildRepairPrompt
};
