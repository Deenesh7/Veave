const { sanitizePath } = require('../../utils/sanitize');

const sanitizeAction = (action) => {
  if (!action || typeof action !== 'object') return null;
  return {
    type: action.type,
    path: sanitizePath(action.path),
    content: action.content || '',
    search: typeof action.search === 'string' ? action.search : '',
    replace: typeof action.replace === 'string' ? action.replace : '',
    reason: action.reason || ''
  };
};

const validateActions = (actions) => {
  if (!Array.isArray(actions)) {
    return { valid: false, errors: ['Actions must be an array'] };
  }

  const sanitizedActions = [];
  const errors = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const cleanAction = sanitizeAction(action);
    
    if (!cleanAction) {
      errors.push(`Action at index ${i} is invalid`);
      continue;
    }

    if (!['create_file', 'modify_file', 'delete_file', 'patch_file'].includes(cleanAction.type)) {
      errors.push(`Invalid type for action at index ${i}`);
    }

    if (!cleanAction.path) {
      errors.push(`Path is required for action at index ${i}`);
    }

    if ((cleanAction.type === 'create_file' || cleanAction.type === 'modify_file') && typeof cleanAction.content !== 'string') {
      errors.push(`Content string is required for create/modify action at index ${i}`);
    }
    if (cleanAction.type === 'patch_file' && (!cleanAction.search || typeof cleanAction.replace !== 'string')) {
      errors.push(`Search and replace strings are required for patch action at index ${i}`);
    }

    if (errors.length === 0) {
      sanitizedActions.push(cleanAction);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, actions: sanitizedActions };
};

module.exports = {
  validateActions,
  sanitizeAction
};
