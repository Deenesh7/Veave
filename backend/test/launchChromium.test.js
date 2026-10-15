const test = require('node:test');
const assert = require('node:assert/strict');
const { launchChromium } = require('../src/services/browser/launchChromium');

test('Chromium launcher retries a transient startup timeout', async () => {
  let attempts = 0;
  const expected = { close() {} };
  const browserType = {
    launch: async (options) => {
      attempts += 1;
      assert.equal(options.timeout, 45000);
      if (attempts === 1) throw new Error('browserType.launch: Timeout 45000ms exceeded');
      return expected;
    }
  };
  assert.equal(await launchChromium({ browserType, timeout: 45000, retries: 1 }), expected);
  assert.equal(attempts, 2);
});

test('Chromium launcher does not retry permanent installation errors', async () => {
  let attempts = 0;
  await assert.rejects(() => launchChromium({
    browserType: { launch: async () => { attempts += 1; throw new Error('Executable does not exist'); } },
    timeout: 45000,
    retries: 1
  }), /Executable does not exist/);
  assert.equal(attempts, 1);
});
