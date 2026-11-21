/**
 * The model request that produces an incremental edit, and the step that applies it.
 *
 *   requestPatch              first request, delimiter retry (with continuations), compact retry on a second model
 *   applyPatchWithCorrection  validate, apply, and when the search text does not match ask the model to correct it against the full files
 *
 * Moved out of jobManager unchanged in behaviour. The orchestrator still decides what a failure means: both functions throw, and
 * provider stops (auth, rate limit) and validation errors keep propagating exactly as before.
 */
const aiProtocol = require('../aiProtocol');
const incrementalEditor = require('../incrementalEditor');
const structuralContext = require('../structuralContext');
const { sourceHash } = require('../validationGate');
const { OpenRouterAuthError, OpenRouterRateLimitError, AIResponseValidationError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

/**
 * @returns {Promise<{ completion, parsed, structuralPlan }>} structuralPlan is null after the compact retry (the full files were shown)
 */
async function requestPatch(ctx) {
  const { jobId, prompt, model, signal, project, targetFiles, compactedProject, uploadedFiles, selectedElement, contextualSelectedElement,
    sourceRefresh, spacingContext, incrementalPrompt, options, retryMaxTokens, billedCompletion, structuralMetrics } = ctx;
  let { structuralPlan } = ctx;
  let completion = null;
  let parsed = null;

  try {
    completion = await billedCompletion(incrementalPrompt.messages, options);
    if (completion?.finishReason === 'length' && !aiProtocol.hasCompleteStructuredResponse(completion)) {
      throw new Error('The AI response was truncated at the configured token limit.');
    }
    parsed = aiProtocol.parseAIResponse(completion, null);
    parsed.files = incrementalEditor.hydrateUploadedImageOperations(parsed.files, uploadedFiles, compactedProject.assets);
    if (selectedElement || sourceRefresh?.focused) incrementalEditor.validateStrictScopeOperations(prompt, parsed.files, project.files, contextualSelectedElement, { sourceFocused: Boolean(sourceRefresh?.focused), sourceFacts: sourceRefresh?.facts || null });
  } catch (pErr) {
    logger.warn(`Job ${jobId} OpenRouter initial incremental parse attempt failed (${pErr.message}); retrying with pure deterministic delimiters...`);
    const toolArgs = completion?.tool_calls?.[0]?.function?.arguments;
    if (toolArgs !== undefined) logger.warn(`Job ${jobId} first attempt tool arguments (${String(toolArgs).length} chars): ${String(toolArgs).slice(0, 300).replace(/\s+/g, ' ')}`);
    logger.warn(`Job ${jobId} first attempt: finish=${completion?.finishReason || 'n/a'} contentChars=${String(completion?.content || '').length} toolCalls=${completion?.tool_calls?.length || 0} promptChars=${incrementalPrompt.messages.reduce((n, m) => n + String(m.content || '').length, 0)}`);
    try {
    const delimiterPrompt = [
      {
        role: 'system',
         content: aiProtocol.DELIMITER_INSTRUCTIONS +
           `\n\nRETRY REQUIREMENT: The previous response failed because: ${pErr.message}\n` +
           'Return only concise PATCH operations for existing files. FILE is allowed only to create a new file. Never rewrite an existing file in full. For a new page, include the page creation plus small import, route/render registration, and navigation patches as one atomic change set.'
      },
      incrementalPrompt.messages[1]
    ];
     completion = await billedCompletion(delimiterPrompt, {
       model,
       temperature: 0.2,
       max_tokens: retryMaxTokens,
       reasoning: { effort: 'low', exclude: true },
       response_format: false
     });
     if (completion?.finishReason === 'length' && !aiProtocol.hasCompleteStructuredResponse(completion)) {
       let combined = String(completion.content || '');
       const continuationMessages = [...delimiterPrompt];
       for (let continuationAttempt = 1; continuationAttempt <= 2; continuationAttempt++) {
         if (!combined || combined.length > 1024 * 1024) break;
         const continued = await billedCompletion([
           ...continuationMessages,
           { role: 'assistant', content: combined },
           { role: 'user', content: 'Continue exactly where the interrupted response stopped. Do not repeat earlier text. Output only the remaining delimiter content, close every open SEARCH, REPLACE, PATCH, and FILE tag, then stop.' }
         ], {
           model,
           temperature: 0,
           max_tokens: 16000,
           reasoning: { effort: 'low', exclude: true },
           response_format: false
         });
         combined = aiProtocol.appendResponseContinuation(combined, continued?.content);
         completion = { ...continued, content: combined };
         if (aiProtocol.hasCompleteStructuredResponse(completion)) break;
       }
       if (!aiProtocol.hasCompleteStructuredResponse(completion)) {
         throw new Error('The AI returned an incomplete patch after two bounded continuation attempts. The partial response was rejected to protect the existing project.');
       }
     }
     parsed = aiProtocol.parseAIResponse(completion, null);
     parsed.files = incrementalEditor.hydrateUploadedImageOperations(parsed.files, uploadedFiles, compactedProject.assets);
     if (selectedElement || sourceRefresh?.focused) incrementalEditor.validateStrictScopeOperations(prompt, parsed.files, project.files, contextualSelectedElement, { sourceFocused: Boolean(sourceRefresh?.focused), sourceFacts: sourceRefresh?.facts || null });
    } catch (retryErr) {
      if (retryErr instanceof OpenRouterAuthError || retryErr instanceof OpenRouterRateLimitError || signal?.aborted) throw retryErr;
      // Last resort: the model returned nothing usable (often a reasoning model that spent its budget thinking). Ask once more with a compact prompt (target files + real-site data only), minimal reasoning and a larger budget.
      logger.warn(`Job ${jobId} delimiter retry failed (${retryErr.message}; finish=${completion?.finishReason || 'n/a'} chars=${String(completion?.content || '').length}; reply: ${String(completion?.content || '').slice(0, 200).replace(/\s+/g, ' ')}); trying a compact prompt with minimal reasoning...`);
      // The compact retry shows the complete target files, so the partial-view plan no longer applies.
      structuralPlan = null;
      structuralMetrics.fullFileRetry = true;
      const compactPrompt = incrementalEditor.buildIncrementalPrompt({ prompt, targetFiles, projectFiles: compactedProject.files, conversation: null, projectProvenance: null, selectedElement: contextualSelectedElement, uploadedFiles, sourceContext: (sourceRefresh?.context || '') + spacingContext, compact: true });
      const compactMessages = [
        { role: 'system', content: aiProtocol.DELIMITER_INSTRUCTIONS + '\n\nReturn ONLY <PATCH path="..."><SEARCH>..</SEARCH><REPLACE>..</REPLACE></PATCH> blocks for existing files (and <FILE path="..."> only for new files). Do not think out loud, do not explain, no code fences. Copy SEARCH text verbatim from the files shown.' },
        compactPrompt.messages[1]
      ];
      // Some models answer with nothing (all budget spent reasoning). Try the same model, then a different one.
      const fallbackModel = String(process.env.INCREMENTAL_FALLBACK_MODEL || process.env.OPENROUTER_MODEL || '').trim();
      const compactModels = [{ model, effort: 'low' }];
      if (fallbackModel && fallbackModel !== model) compactModels.push({ model: fallbackModel, effort: 'low' });
      for (let compactIndex = 0; compactIndex < compactModels.length; compactIndex += 1) {
        const attempt = compactModels[compactIndex];
        completion = await billedCompletion(compactMessages, { model: attempt.model, temperature: 0, max_tokens: 32000, reasoning: { effort: attempt.effort, exclude: true }, response_format: false });
        logger.warn(`Job ${jobId} compact attempt ${compactIndex + 1} (${attempt.model}): finish=${completion?.finishReason || 'n/a'} chars=${String(completion?.content || '').length}`);
        if (completion?.reasoning && completion.content === completion.reasoning) completion = { ...completion, content: '' };
        if (String(completion?.content || '').trim()) break;
      }
      parsed = aiProtocol.parseAIResponse(completion, null);
      parsed.files = incrementalEditor.hydrateUploadedImageOperations(parsed.files, uploadedFiles, compactedProject.assets);
     if (selectedElement || sourceRefresh?.focused) incrementalEditor.validateStrictScopeOperations(prompt, parsed.files, project.files, contextualSelectedElement, { sourceFocused: Boolean(sourceRefresh?.focused), sourceFacts: sourceRefresh?.facts || null });
    }

  }
  return { completion, parsed, structuralPlan };
}

/**
 * @returns {Promise<{ validated, applied }>}
 */
async function applyPatchWithCorrection(ctx) {
  const { jobId, prompt, model, project, compactedProject, uploadedFiles, selectedElement, contextualSelectedElement, sourceRefresh,
    incrementalPrompt, retryMaxTokens, billedCompletion, structuralMetrics, structuralPlan } = ctx;
  let { completion, parsed } = ctx;
  let validated = aiProtocol.validateFileOperations(parsed, project.files);
  let applied;
  try {
    // Before applying: the edit must stay inside what the model was shown and match the source it read.
    structuralContext.assertOperationsMatchPlan(structuralPlan, validated.files, project.files, { projectKey: String(project._id) });
    applied = aiProtocol.applyOperationsSafely(project.files, validated.files);
    // A patch whose REPLACE equals its SEARCH "applies" but does nothing: ask for a real change instead of ending the job.
    if (sourceHash(applied.files) === sourceHash(project.files)) throw new Error('The patch changed nothing: the replacement text is identical to the text it replaces.');
    // After applying: re-parse the result and compare it with the original.
    structuralContext.assertAppliedStructure({ before: project.files, after: applied.files, plan: structuralPlan, prompt, operations: validated.files, resolveImportPath: incrementalEditor.resolveImportPath, projectKey: String(project._id) });
  } catch (applyError) {
    if (applyError instanceof structuralContext.StructuralEditError) {
      structuralMetrics.structuralRejections += 1;
      structuralMetrics.fullFileRetry = true;
      logger.warn(`Job ${jobId} structural check rejected the edit: ${applyError.message}`);
    } else if (!/Patch search block not found|search block matched \d+ locations|The patch changed nothing/i.test(applyError.message)) throw applyError; // a missing OR ambiguous search text is corrected against the full file

    const failedPaths = [...new Set(validated.files.map((file) => file.path))];
    const authoritativeFiles = compactedProject.files
      .filter((file) => file && failedPaths.includes(file.path));
    const correctionMessages = [{
      role: 'system',
      content: `${incrementalPrompt.systemPrompt}\n\n${/changed nothing/i.test(applyError.message) ? 'PATCH CORRECTION: Your previous patch changed nothing, so the request was NOT done. Make the requested change for real: the REPLACE text must differ from the SEARCH text and must add/alter exactly what the user asked for (for an image: an <img> with the attached image token or a real image link, with alt text, in the place they named).' : 'PATCH CORRECTION: A prior patch did not match the current project.'} Return only corrected PATCH delimiters. Copy each SEARCH block verbatim from the authoritative file content below. Do not reuse or approximate the failed search text.`
    }, {
      role: 'user',
      content: `USER REQUEST:\n${prompt}\n\nAPPLICATION ERROR:\n${applyError.message}\n\nAUTHORITATIVE CURRENT FILES:\n${authoritativeFiles.map((file) => `--- FILE: ${file.path} ---\n${file.content}`).join('\n\n')}\n\nReturn only the minimal corrected <PATCH> operation(s).`
    }];

    logger.warn(`Job ${jobId} retrying an unmatched OpenRouter patch against authoritative file contents.`);
    if (sourceRefresh?.context) {
      correctionMessages[1].content += `\n\n${sourceRefresh.context}`;
    }
    let correctionError = null;
    for (let correctionAttempt = 1; correctionAttempt <= 3; correctionAttempt++) {
      try {
        const askCorrection = (correctionModel) => billedCompletion(correctionMessages, {
          model: correctionModel,
          temperature: correctionAttempt === 1 ? 0 : 0.3,
          max_tokens: retryMaxTokens,
          reasoning: { effort: 'low', exclude: true },
          response_format: false
        });
        completion = await askCorrection(model);
        if (completion?.reasoning && completion.content === completion.reasoning) completion = { ...completion, content: '' };
        // Some editor models (reasoning models) finish with an empty reply after spending their budget thinking.
        // Ask a different model right away instead of repeating the same empty answer.
        const correctionFallbackModel = String(process.env.INCREMENTAL_FALLBACK_MODEL || process.env.OPENROUTER_MODEL || '').trim();
        if (!String(completion?.content || '').trim() && !completion?.tool_calls?.length && correctionFallbackModel && correctionFallbackModel !== model) {
          logger.warn(`Job ${jobId} patch correction attempt ${correctionAttempt}: ${model} returned an empty reply; asking ${correctionFallbackModel} instead.`);
          completion = await askCorrection(correctionFallbackModel);
          if (completion?.reasoning && completion.content === completion.reasoning) completion = { ...completion, content: '' };
        }
        if (completion?.finishReason === 'length' && !aiProtocol.hasCompleteStructuredResponse(completion)) {
          throw new Error('The AI patch correction was truncated.');
        }
        parsed = aiProtocol.parseAIResponse(completion, null);
        if (!parsed.files?.length) throw new Error('The correction contained no file operations.');
        parsed.files = incrementalEditor.hydrateUploadedImageOperations(parsed.files, uploadedFiles, compactedProject.assets);
        if (selectedElement || sourceRefresh?.focused) incrementalEditor.validateStrictScopeOperations(prompt, parsed.files, project.files, contextualSelectedElement, { sourceFocused: Boolean(sourceRefresh?.focused), sourceFacts: sourceRefresh?.facts || null });
        validated = aiProtocol.validateFileOperations(parsed, project.files);
        structuralMetrics.correctionAttempts += 1;
        applied = aiProtocol.applyOperationsSafely(project.files, validated.files);
        // The correction was written against the complete files, so only the after-the-fact checks apply.
        structuralContext.assertAppliedStructure({ before: project.files, after: applied.files, plan: null, prompt, operations: validated.files, resolveImportPath: incrementalEditor.resolveImportPath, projectKey: String(project._id) });
        correctionError = null;
        break;
      } catch (attemptError) {
        if (attemptError instanceof AIResponseValidationError || attemptError instanceof OpenRouterAuthError || attemptError instanceof OpenRouterRateLimitError) throw attemptError;
        correctionError = attemptError;
        const preview = String(completion?.content ?? '').slice(0, 400).replace(/\s+/g, ' ');
        logger.warn(`Job ${jobId} patch correction attempt ${correctionAttempt} failed: ${attemptError.message} | finish=${completion?.finishReason || 'n/a'} | response="${preview}"`);
        correctionMessages[1].content = correctionMessages[1].content.split('\n\nFORMAT REMINDER:')[0]
          + `\n\nFORMAT REMINDER: your last reply was unusable (${attemptError.message}). Reply with ONLY one or more blocks of exactly this form and nothing else (no prose, no code fences):\n<PATCH path="relative/file.jsx">\n<SEARCH>\nexact existing text copied from the file above\n</SEARCH>\n<REPLACE>\nnew text\n</REPLACE>\n</PATCH>\nKeep SEARCH short (one to five lines) and unique in the file.`;
      }
    }
    if (correctionError) throw correctionError;
  }
  return { validated, applied };
}

module.exports = { requestPatch, applyPatchWithCorrection };
