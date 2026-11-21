/**
 * Code generation worker (new sites): asks the model for a complete project as file operations and turns the answer into files.
 *
 * It escalates only as far as it must: a structured tool call, then FILE delimiters, then a repair prompt, then a deterministic salvage
 * of what the model already produced (and a targeted fix of the leftover compile errors), then a request for only the missing entry
 * file. Valid files are preserved at every step. Permanent provider failures (bad key, no credits, rate limit) are rethrown so the
 * orchestrator can end the job; any other failure is returned so it can choose a fallback. It never edits job or project state.
 */
const aiProtocol = require('../aiProtocol');
const templateService = require('../../templates/templateService');
const { AIResponseValidationError } = require('../../../utils/errors');
const { mergeOpenRouterUsage } = require('../jobSupport/usage');
const { generateWithRetry: generateWithRetryBase, isProviderStop } = require('../jobSupport/retry');

/**
 * @param input { baseMessages, contextPromptText, template, templateBaseFiles, model, isIncremental, existingFiles, log, signal }
 * @param deps  { completeOpenRouterResponse, parseInitialProjectResponse, salvagePartialProject, compactClonePageSource }
 *              (shared with the clone flows, so they are handed in instead of imported from the job manager)
 * @returns {{ ok: true, updatedFiles, generatedChanges, generatedAppCode, tokenUsage } | { ok: false, providerFailureReason }}
 */
async function generateProject({ baseMessages, contextPromptText, template = null, templateBaseFiles = [], model, isIncremental = false, existingFiles = [], log, signal = null }, deps) {
  // Every model call carries the job's signal, so cancelling the job stops the call that is in flight.
  const generateWithRetry = (messages, options) => generateWithRetryBase(messages, options, { signal });
  const { completeOpenRouterResponse, parseInitialProjectResponse, salvagePartialProject, compactClonePageSource } = deps;
  const result = { updatedFiles: null, generatedChanges: null, generatedAppCode: null, tokenUsage: null };
  try {
                            const defaultModularInstruction = `Generate a modular React project as file operations. The FIRST file operation must create src/App.jsx; never defer the entry file until the end. Create separate files under src/pages and src/components after it. Every local import in src/App.jsx and every generated module must resolve to a file returned in the same response, with default and named imports matching the target exports exactly. For a sequential website clone, create a valid minimal page module for every route registered in App even when that page body will be completed later. Never import a page that you did not create. Keep modules compact by extracting repeated UI. App.jsx must stay under 500 lines and contain only providers, routing, shared layout composition, and top-level state. Do not put the complete website in App.jsx. Style everything with Tailwind CSS utility classes (use arbitrary values like w-[1354px] or text-[#d9d9d9] for exact measurements) and do NOT create per-page or per-component .css files or a styles.css; src/index.css with the @tailwind directives is the only stylesheet.`;
              const templateInstruction = `Customise the selected template, which is already in the project. Do NOT create src/App.jsx, src/main.jsx or any template file from scratch: use "patch" (exact unique search block) or "modify" for existing files and "create" only for new pages and components. Keep the template's shared components, locked files and design tokens. Register every new page as a <Route> in src/App.jsx and add it to src/data/site.js navigation. Every local import must resolve to an existing or newly created file, and every link must point to a registered route. Style with Tailwind and the template's semantic colour classes; do not add per-page .css files.`;
              const modularInstruction = template ? templateInstruction : defaultModularInstruction;
              const messages = [
                { role: 'system', content: `${baseMessages[0].content}\n\n${modularInstruction}` },
                ...baseMessages.slice(1)
              ];
              // Template jobs start from the template's files: the model's operations are applied on top of them.
              let accumulatedProjectFiles = templateBaseFiles.map((file) => ({ ...file }));
              const generationTimeout = Number.parseInt(process.env.OPENROUTER_GENERATION_TIMEOUT_MS, 10) || 300000;
              const parseProject = (response) => {
                try {
                  accumulatedProjectFiles = parseInitialProjectResponse(response, accumulatedProjectFiles);
                  if (template && !templateService.differsFromTemplate(accumulatedProjectFiles, template)) {
                    const unchanged = new AIResponseValidationError('The response left the selected template unchanged: apply the requested brand, content, pages and features to the template files.');
                    unchanged.partialFiles = accumulatedProjectFiles;
                    throw unchanged;
                  }
                  return accumulatedProjectFiles;
                } catch (error) {
                  if (Array.isArray(error.partialFiles)) accumulatedProjectFiles = error.partialFiles;
                  throw error;
                }
              };
              const preservedProjectContext = () => JSON.stringify(compactClonePageSource(accumulatedProjectFiles, '/', 24000), null, 2);
              let completion;
              let projectFiles;
              try {
                completion = await generateWithRetry(messages, {
                  model,
                   max_tokens: parseInt(process.env.OPENROUTER_GENERATION_MAX_TOKENS, 10) || 24000,
                   timeout: generationTimeout,
                   reasoning: { effort: 'low', exclude: true },
                  plugins: [{ id: 'context-compression' }],
                  tools: [aiProtocol.FILE_OPERATIONS_TOOL],
                  tool_choice: { type: 'function', function: { name: aiProtocol.FILE_OPERATIONS_TOOL.function.name } }
                });
                completion = await completeOpenRouterResponse(messages, completion, {
                  model,
                  structured: true,
                  continuationInstruction: 'Continue the interrupted file-operation arguments exactly where they stopped. Complete all files and close the structured response.'
                });
                projectFiles = parseProject(completion);
              } catch (structuredError) {
                if (isProviderStop(structuredError)) throw structuredError;
                const delimiterMessages = [{
                  role: 'system',
                  content: `${modularInstruction}\nReturn only complete FILE delimiters.\n\n${aiProtocol.DELIMITER_INSTRUCTIONS}`
                 }, baseMessages.at(-1), {
                   role: 'user',
                   content: `The structured attempt failed: ${structuredError.message}. Valid files from that attempt are preserved below. Return only the missing or corrected files using FILE operation="create" blocks; do not repeat valid files.\n\nPRESERVED FILES:\n${preservedProjectContext()}`
                 }];
                completion = await generateWithRetry(delimiterMessages, {
                  model,
                   max_tokens: parseInt(process.env.OPENROUTER_GENERATION_MAX_TOKENS, 10) || 24000,
                   timeout: generationTimeout,
                   reasoning: { effort: 'low', exclude: true },
                  plugins: [{ id: 'context-compression' }],
                  response_format: false
                });
                completion = await completeOpenRouterResponse(delimiterMessages, completion, {
                  model,
                  structured: true,
                  continuationInstruction: 'Continue exactly after the interrupted FILE delimiter. Do not repeat prior output. Finish all source files and close every FILE tag.'
                });
                try {
                  projectFiles = parseProject(completion);
                } catch (delimiterError) {
                  if (isProviderStop(delimiterError)) throw delimiterError;
                  const repairMessages = [
                    ...delimiterMessages,
                    { role: 'assistant', content: completion.content || '' },
                    {
                     role: 'user',
                     content: `The project is still incomplete because ${delimiterError.message}. The valid files below are already preserved. Return only the missing or corrected FILE operation="create" blocks needed to complete the project. Do not repeat valid files or return commentary.\n\nPRESERVED FILES:\n${preservedProjectContext()}`
                   }
                  ];
                  completion = await generateWithRetry(repairMessages, {
                    model,
                    temperature: 0,
                     max_tokens: parseInt(process.env.OPENROUTER_GENERATION_MAX_TOKENS, 10) || 24000,
                     timeout: generationTimeout,
                     reasoning: { effort: 'low', exclude: true },
                    plugins: [{ id: 'context-compression' }],
                    response_format: false
                  });
                  completion = await completeOpenRouterResponse(repairMessages, completion, {
                    model,
                    structured: true,
                    continuationInstruction: 'Continue exactly after the interrupted FILE delimiter. Do not repeat prior output. Finish all source files and close every FILE tag.'
                  });
                  try {
                    projectFiles = parseProject(completion);
                  } catch (repairError) {
                    if (isProviderStop(repairError)) throw repairError;
                    // Last resort before another paid call: complete what the model already produced deterministically
                    // (missing exports, case-mismatched imports, stub pages) when an App and modular files exist.
                    let remainingDiagnostics = '';
                    let salvaged = salvagePartialProject(accumulatedProjectFiles, (text, fixed) => { remainingDiagnostics = text; accumulatedProjectFiles = fixed; });
                    if (!salvaged && remainingDiagnostics) {
                      // Feed the exact leftover errors (after the free deterministic fixes) back to the model for one targeted repair.
                      log.warn(`deterministic salvage left errors; asking the model to fix them:\n${remainingDiagnostics}`);
                      try {
                        const fixMessages = [{
                          role: 'system',
                          content: `You fix compile errors in a React project. Return only complete <FILE path="..." operation="create"> blocks for the files that must change (full file contents), no commentary. Every import must resolve to an existing file and match its default or named export.\n\n${aiProtocol.DELIMITER_INSTRUCTIONS}`
                        }, {
                          role: 'user',
                          content: `Fix exactly these errors:\n${remainingDiagnostics}\n\nCURRENT PROJECT:\n${preservedProjectContext()}`
                        }];
                        const fixCompletion = await generateWithRetry(fixMessages, { model, temperature: 0, max_tokens: 12000, timeout: generationTimeout, reasoning: { effort: 'low', exclude: true }, response_format: false });
                        const merged = aiProtocol.applyOperationsSafely(accumulatedProjectFiles, aiProtocol.validateFileOperations(aiProtocol.parseAIResponse(fixCompletion.content || '', 'src/App.jsx'), accumulatedProjectFiles).files).files;
                        salvaged = salvagePartialProject(merged, (text) => { remainingDiagnostics = text; });
                      } catch (fixError) {
                        if (isProviderStop(fixError)) throw fixError;
                        log.warn(`targeted error repair failed: ${fixError.message}`);
                      }
                    }
                    if (!salvaged && remainingDiagnostics) log.warn(`still invalid after targeted repair:\n${remainingDiagnostics}`);
                    if (salvaged) {
                      log.warn(`salvaged ${salvaged.length} generated files deterministically after: ${repairError.message.split('\n')[0]}`);
                      projectFiles = salvaged;
                    } else {
                    const hasModularFiles = accumulatedProjectFiles.some((file) => /^src\/(?:pages|components)\//.test(file.path));
                    if (!/did not create src\/App\.jsx/i.test(repairError.message) || !hasModularFiles) throw repairError;
                    const preservedPaths = accumulatedProjectFiles.map((file) => file.path);
                    log.warn(`requesting only missing src/App.jsx after preserving ${preservedPaths.length} generated files.`);

                    const entryMessages = [{
                      role: 'system',
                      content: `Create exactly one missing React entry file. Return only one complete <FILE path="src/App.jsx" operation="create"> block and no commentary. Import and compose the preserved pages/components where appropriate. Every import must exactly match the target file's default or named export. Do not render an identifier unless its import is present and valid. Keep App.jsx under 500 lines.\n\n${aiProtocol.DELIMITER_INSTRUCTIONS}`
                    }, {
                      role: 'user',
                      content: `src/App.jsx is the only missing file. Create it now as the first and only output. These files already exist and must not be repeated.\n\nEXISTING FILE PATHS:\n${JSON.stringify(preservedPaths, null, 2)}\n\nCOMPACT EXISTING SOURCE:\n${preservedProjectContext()}`
                    }];
                    completion = await generateWithRetry(entryMessages, {
                      model,
                      temperature: 0,
                      max_tokens: 8000,
                      timeout: generationTimeout,
                      reasoning: { effort: 'low', exclude: true },
                      response_format: false
                    });
                    completion = await completeOpenRouterResponse(entryMessages, completion, {
                      model,
                      structured: true,
                      continuationInstruction: 'Continue only the interrupted src/App.jsx FILE block and close its FILE tag.'
                    });
                    projectFiles = parseProject(completion);
                    }
                  }
                }
              }
              // Editing with an attached image must keep every existing file the model did not re-emit.
              result.updatedFiles = isIncremental
                ? [...new Map([...(existingFiles || []), ...projectFiles].map((file) => [file.path, file])).values()]
                : projectFiles;
              result.generatedChanges = projectFiles;
              result.generatedAppCode = projectFiles.find((file) => file.path === 'src/App.jsx').content;
              if (result.generatedAppCode) {
              const estimatedPromptTokens = Math.ceil(contextPromptText.length / 4);
              const estimatedCompletionTokens = Math.ceil(projectFiles.reduce((sum, file) => sum + file.content.length, 0) / 4);
              result.tokenUsage = completion.usage
                ? mergeOpenRouterUsage(null, completion.usage, model)
                : {
                    promptTokens: estimatedPromptTokens,
                    completionTokens: estimatedCompletionTokens,
                    totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
                    modelUsed: model || 'Veave AI',
                    provider: 'Veave AI',
                    cost: 0,
                    costReported: false
                  };
              }
  } catch (error) {
    if (isProviderStop(error)) throw error;
    log.warn(`contextual generation fallback: ${error.message}`);
    return { ok: false, providerFailureReason: error.message };
  }
  return { ok: true, ...result };
}

module.exports = { generateProject };
