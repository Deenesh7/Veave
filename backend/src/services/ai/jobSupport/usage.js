/** Token and cost accounting for the model calls of one job. Pure functions; no database or network. */
function mergeOpenRouterUsage(current, usage, model) {
  if (!usage) return current;
  const promptTokens = Number(usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completion_tokens) || 0;
  const totalTokens = Number(usage.total_tokens) || promptTokens + completionTokens;
  const usageCost = Number(usage.cost);
  const currentCost = Number(current?.cost);
  return {
    promptTokens: (current?.promptTokens || 0) + promptTokens,
    completionTokens: (current?.completionTokens || 0) + completionTokens,
    totalTokens: (current?.totalTokens || 0) + totalTokens,
    modelUsed: model || current?.modelUsed || 'Veave AI',
    provider: 'Veave AI',
    cost: (Number.isFinite(currentCost) ? currentCost : 0) + (Number.isFinite(usageCost) ? usageCost : 0),
    costReported: Boolean(current?.costReported || Number.isFinite(usageCost))
  };
}

// Usage of every billable model call in one edit (patch attempts, corrections, repairs). A provider that reports no usage
// is ESTIMATED from text length and flagged, never silently counted as zero.
function addBilledUsage(current, completion, messages, model) {
  if (completion?.usage && (Number(completion.usage.total_tokens) || Number(completion.usage.prompt_tokens) || Number(completion.usage.completion_tokens))) {
    const merged = mergeOpenRouterUsage(current, completion.usage, model);
    return { ...merged, usageSource: current?.usageSource === 'estimated' ? 'estimated' : 'reported' };
  }
  const prompt = Math.ceil((messages || []).reduce((n, m) => n + String(m?.content || '').length, 0) / 4);
  const output = Math.ceil(String(completion?.content || '').length / 4);
  const merged = mergeOpenRouterUsage(current, { prompt_tokens: prompt, completion_tokens: output, total_tokens: prompt + output }, model);
  return { ...merged, usageSource: 'estimated' };
}

function sumUsageRecords(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const cost = (Number(a.cost) || 0) + (Number(b.cost) || 0);
  return {
    ...a,
    promptTokens: (a.promptTokens || 0) + (b.promptTokens || 0),
    completionTokens: (a.completionTokens || 0) + (b.completionTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
    cost,
    costReported: Boolean(a.costReported || b.costReported),
    usageSource: a.usageSource === 'estimated' || b.usageSource === 'estimated' ? 'estimated' : (a.usageSource || b.usageSource || 'reported')
  };
}

function mergeRawOpenRouterUsage(current, usage) {
  if (!usage) return current || null;
  const promptTokens = (Number(current?.prompt_tokens) || 0) + (Number(usage.prompt_tokens) || 0);
  const completionTokens = (Number(current?.completion_tokens) || 0) + (Number(usage.completion_tokens) || 0);
  const currentCost = Number(current?.cost);
  const usageCost = Number(usage.cost);
  const costReported = Number.isFinite(currentCost) || Number.isFinite(usageCost);
  return {
    ...current,
    ...usage,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: (Number(current?.total_tokens) || 0) + (Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0)),
    ...(costReported ? { cost: (Number.isFinite(currentCost) ? currentCost : 0) + (Number.isFinite(usageCost) ? usageCost : 0) } : {})
  };
}

module.exports = { mergeOpenRouterUsage, addBilledUsage, sumUsageRecords, mergeRawOpenRouterUsage };
