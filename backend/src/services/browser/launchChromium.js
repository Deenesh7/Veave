const { chromium } = require('playwright');

async function launchChromium({ browserType = chromium, timeout, retries = 1 } = {}) {
  const launchTimeout = timeout || Math.max(30000, Number.parseInt(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS, 10) || 90000);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // PLAYWRIGHT_CHROMIUM_PATH points straight at the browser binary, so nothing is looked up at start. The flags skip work a scraper never needs.
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
      return await browserType.launch({ headless: true, timeout: launchTimeout, ...(executablePath ? { executablePath } : {}), args: ['--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking', '--mute-audio'] });
    } catch (error) {
      lastError = error;
      const transient = /timeout|target page, context or browser has been closed|browser closed/i.test(error.message || '');
      if (!transient || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

/**
 * One Chromium that several scrapes share (the first crawl, then every "scrape more pages" request), so the browser is started
 * once instead of once per scrape. It is started on first use, started again if it died, and closed by close() or after
 * `idleMs` without use (so a plan nobody answers cannot keep a browser open for ever).
 */
function createBrowserSession({ browserType = chromium, idleMs = 10 * 60 * 1000 } = {}) {
  let browser = null;
  let starting = null;
  let timer = null;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { close().catch(() => {}); }, idleMs);
    timer.unref?.();
  };
  async function get() {
    if (browser && browser.isConnected()) { touch(); return browser; }
    if (!starting) {
      starting = launchChromium({ browserType }).then((launched) => { browser = launched; return launched; }).finally(() => { starting = null; });
    }
    const launched = await starting;
    touch();
    return launched;
  }
  async function close() {
    clearTimeout(timer);
    const current = browser;
    browser = null;
    if (current) await current.close().catch(() => {});
  }
  return { get, close, touch };
}

module.exports = { launchChromium, createBrowserSession };
