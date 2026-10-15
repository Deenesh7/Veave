const { chromium } = require('playwright');

async function launchChromium({ browserType = chromium, timeout, retries = 1 } = {}) {
  const launchTimeout = timeout || Math.max(30000, Number.parseInt(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS, 10) || 90000);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await browserType.launch({ headless: true, timeout: launchTimeout });
    } catch (error) {
      lastError = error;
      const transient = /timeout|target page, context or browser has been closed|browser closed/i.test(error.message || '');
      if (!transient || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

module.exports = { launchChromium };
