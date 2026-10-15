const getErrorFixPrompt = (error, relevantFiles) => {
  const fileContext = relevantFiles.map(f => `--- ${f.path} ---\n${f.content}\n`).join('\n');

  return `Fix the following error in the application:
Error:
"${error}"

Relevant files context:
${fileContext}

Rules for fixing:
1. Identify the root cause of the error.
2. Fix the issue minimally - do not rewrite entire files if a small change suffices.
3. Do not break other functionality while fixing this error.
4. Ensure components are properly registered and retrieved via window.__modules.`;
};

module.exports = { getErrorFixPrompt };
