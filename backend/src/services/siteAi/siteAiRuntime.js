// window.VEAVE_AI.ask(question, { topic }) -> Promise<string>: how a generated website asks the assistant (POST /api/site-ai/ask).
// The same helper is added to the studio preview (in the frontend) and to every page of a published website (here).
const apiBase = () => String(process.env.PUBLIC_API_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '').replace(/\/api$/, '');

function runtimeScript(projectId) {
  const endpoint = `${apiBase()}/api/site-ai/ask`;
  return `<script>window.VEAVE_AI={endpoint:${JSON.stringify(endpoint)},project:${JSON.stringify(String(projectId))},ask:function(q,o){o=o||{};var self=this;return fetch(self.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:self.project,question:String(q||''),topic:o.topic||''})}).then(function(r){return r.json().catch(function(){return {};}).then(function(d){if(!r.ok||!d.success)throw new Error((d&&d.error&&d.error.message)||'The assistant is unavailable right now.');return d.answer;});});}};</script>`;
}

/** Adds the helper to the <head> of every HTML file of a build (files are { path, buffer }). Files without a <head> are left alone. */
function injectIntoFiles(files, projectId) {
  if (!apiBase()) return files; // no public address configured: nothing to call
  const script = runtimeScript(projectId);
  return files.map((file) => {
    if (!/\.html?$/i.test(file.path) || !Buffer.isBuffer(file.buffer)) return file;
    const html = file.buffer.toString('utf8');
    if (html.includes('window.VEAVE_AI=') || !/<head[^>]*>/i.test(html)) return file;
    return { ...file, buffer: Buffer.from(html.replace(/<head[^>]*>/i, (open) => `${open}${script}`), 'utf8') };
  });
}

module.exports = { runtimeScript, injectIntoFiles };
