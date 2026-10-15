const { SYSTEM_PROMPT } = require('./prompts/systemPrompt');
const { getUIGenerationPrompt } = require('./prompts/uiGenerationPrompt');
const { getModificationPrompt } = require('./prompts/modificationPrompt');
const { getErrorFixPrompt } = require('./prompts/errorFixPrompt');

const determineRequestType = (project, message) => {
  if (!project.files || project.files.length === 0) {
    return 'generation';
  }
  if (message.toLowerCase().includes('error:') || message.toLowerCase().includes('fix this')) {
    return 'error_fix';
  }
  return 'modification';
};

const buildContext = (project, conversation, userMessage, options = {}) => {
  const messages = [];
  
  messages.push({ role: 'system', content: SYSTEM_PROMPT });

  let projectContext = `Project Name: ${project.name}\n`;
  if (project.description) projectContext += `Description: ${project.description}\n`;
  if (project.files && project.files.length > 0) {
    projectContext += `Existing Files: ${project.files.map(f => f.path).join(', ')}`;
  }
  messages.push({ role: 'system', content: projectContext });

  if (project.files && project.files.length > 0) {
    let fileContents = 'File Contents:\n';
    project.files.forEach(f => {
      fileContents += `--- ${f.path} ---\n${f.content}\n`;
    });
    // Optional: truncate if too large
    messages.push({ role: 'system', content: fileContents });
  }

  if (conversation && conversation.messages) {
    const history = conversation.messages.slice(-20).map(m => ({
      role: m.role === 'system' ? 'assistant' : m.role,
      content: m.content
    }));
    messages.push(...history);
  }

  const reqType = determineRequestType(project, userMessage);
  let finalUserPrompt = '';
  
  if (reqType === 'generation') {
    finalUserPrompt = getUIGenerationPrompt(userMessage);
  } else if (reqType === 'error_fix') {
    finalUserPrompt = getErrorFixPrompt(userMessage, project.files);
  } else {
    finalUserPrompt = getModificationPrompt(userMessage, project.files, options.selectedElement);
  }

  messages.push({ role: 'user', content: finalUserPrompt });

  return messages;
};

module.exports = {
  buildContext,
  determineRequestType
};
