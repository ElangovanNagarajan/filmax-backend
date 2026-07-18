import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  return browser;
}

export async function withPage(fn) {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-IN',
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function shutdownBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
