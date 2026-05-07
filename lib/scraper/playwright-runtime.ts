// Playwright runtime: each scrape gets a fresh browser (no caching, so
// multiple scrapes in same Lambda warm instance don't share closed contexts).
import type { Browser, BrowserContext } from 'playwright-core';

const REMOTE_CHROMIUM_TAR = 'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar';

export interface BrowserHandle {
  browser: Browser;
  context: BrowserContext;
}

async function launchBrowser(): Promise<Browser> {
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;
  const { chromium } = await import('playwright-core');
  if (isLambda) {
    const chromiumPkg = await import('@sparticuz/chromium-min');
    const chromiumDefault = chromiumPkg.default;
    const executablePath = await chromiumDefault.executablePath(REMOTE_CHROMIUM_TAR);
    return await chromium.launch({
      args: chromiumDefault.args,
      executablePath,
      headless: true,
    });
  }
  try {
    const localPlaywright = await import('playwright');
    return await localPlaywright.chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

export async function openBrowser(): Promise<BrowserHandle> {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-TW',
  });
  return { browser, context };
}

export async function closeHandle(h: BrowserHandle | null): Promise<void> {
  if (!h) return;
  await h.context.close().catch(() => {});
  await h.browser.close().catch(() => {});
}
