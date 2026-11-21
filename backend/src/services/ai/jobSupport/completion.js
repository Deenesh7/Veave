/** Finishes a model answer that was cut off by asking the model to continue it, adding up the usage of every call. */
const aiProtocol = require('../aiProtocol');
const { generateWithRetry } = require('./retry');
const { mergeRawOpenRouterUsage } = require('./usage');
const { AIResponseMalformedError } = require('../../../utils/errors');

async function completeOpenRouterResponse(messages, completion, {
  model,
  continuationInstruction,
  structured = false,
  maxContinuations = Number.parseInt(process.env.OPENROUTER_MAX_CONTINUATIONS, 10) || 4,
  timeout = 120000
} = {}) {
  // A structured answer is finished when the provider did not cut it for length AND nothing in it is visibly cut off (a provider can
  // report "stop" for tool-call JSON that ends mid-string, or leave a <FILE> block open).
  const isFinished = (candidate) => (candidate?.finishReason !== 'length' && !(structured && aiProtocol.isIncompleteStructuredResponse(candidate)))
    || (structured && candidate?.finishReason === 'length' && aiProtocol.hasCompleteStructuredResponse(candidate));
  if (isFinished(completion)) {
    return completion;
  }

  const initialToolCalls = Array.isArray(completion?.tool_calls) ? completion.tool_calls : null;
  const partialToolArguments = initialToolCalls?.[0]?.function?.arguments || initialToolCalls?.[0]?.arguments;
  let combined = String(partialToolArguments || completion?.content || '');
  let aggregateUsage = completion?.usage || null;
  for (let attempt = 0; attempt < maxContinuations; attempt++) {
    if (!combined || combined.length > 1024 * 1024) break;
    const continued = await generateWithRetry([
      ...messages,
      { role: 'assistant', content: combined },
      { role: 'user', content: continuationInstruction }
    ], {
      model,
      temperature: 0,
      max_tokens: 16000,
      plugins: [{ id: 'context-compression' }],
      reasoning: { effort: 'low', exclude: true },
      response_format: false,
      timeout
    });
    const continuedToolArguments = continued?.tool_calls?.[0]?.function?.arguments || continued?.tool_calls?.[0]?.arguments;
    aggregateUsage = mergeRawOpenRouterUsage(aggregateUsage, continued?.usage);
    const continuation = continuedToolArguments || continued?.content;
    // A continuation that returns nothing cannot make progress; do not spend the remaining attempts on it.
    if (!String(continuation || '').trim()) break;
    combined = aiProtocol.appendResponseContinuation(combined, continuation);
    const tool_calls = initialToolCalls?.map((call, index) => index === 0
      ? { ...call, function: call.function ? { ...call.function, arguments: combined } : undefined, arguments: call.function ? call.arguments : combined }
      : call);
    completion = { ...continued, content: initialToolCalls ? '' : combined, tool_calls: tool_calls || continued?.tool_calls || null, usage: aggregateUsage };
    if (isFinished(completion)) {
      return completion;
    }
  }

  const message = structured
    ? `The AI returned an incomplete structured response after ${maxContinuations} continuation attempt(s).`
    : `The AI returned incomplete generated code after ${maxContinuations} continuation attempt(s).`;
  if (structured) throw new AIResponseMalformedError(message);
  throw new Error(message);
}

module.exports = { completeOpenRouterResponse };
