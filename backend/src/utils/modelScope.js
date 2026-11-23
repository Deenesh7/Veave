const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Veave reaches one model through OpenRouter (see openrouterService.resolveModel). A job may run inside a scope that names a different
 * model for everything it calls: the template studio's page and section editors use TEMPLATE_EDIT_MODEL. Outside a scope nothing changes.
 */
const storage = new AsyncLocalStorage();

const current = () => storage.getStore()?.model || null;
const run = (model, fn) => (model ? storage.run({ model: String(model) }, fn) : fn());

module.exports = { current, run };
