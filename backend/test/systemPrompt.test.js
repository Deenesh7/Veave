const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SYSTEM_PROMPT,
  UI_GENERATION_SYSTEM_PROMPT,
  SYSTEM_PROMPT_VERSION
} = require('../src/services/ai/prompts/systemPrompt');
const { apply } = require('../src/services/prompt/designSystemProcessor');

test('UI generation prompt enforces componentized application structure', () => {
  assert.equal(SYSTEM_PROMPT_VERSION, 'v2.1.0');
  assert.match(UI_GENERATION_SYSTEM_PROMPT, /Do not build the entire application inside src\/App\.jsx\./);
  assert.match(UI_GENERATION_SYSTEM_PROMPT, /Each major page must have its own component file\./);
  assert.match(UI_GENERATION_SYSTEM_PROMPT, /Inspect the existing project structure\./);
  assert.match(UI_GENERATION_SYSTEM_PROMPT, /Do not over-componentize trivial markup/);
  assert.match(UI_GENERATION_SYSTEM_PROMPT, /Verify every import, export, relative path, route, and module registration/);
  assert.ok(SYSTEM_PROMPT.includes('COMPONENTIZATION AND FILE STRUCTURE'));
});

test('reference-preservation mode does not inject Veave visual defaults', () => {
  const spec = apply({ technology: { framework: 'react', styling: 'css', icons: 'lucide-react' } }, 'Modern', { preserveReferenceDesign: true });
  assert.equal(spec.designSystem.name, 'source-reference');
  assert.match(spec.designSystem.typography.primary, /captured source font family/);
  assert.match(spec.visualConstraints.join('\n'), /override every default design preference/);
  assert.doesNotMatch(JSON.stringify(spec.designSystem), /Inter|#111827|12px|16px/);
});
