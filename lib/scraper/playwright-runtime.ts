// Playwright runtime that works on both local dev and Vercel serverless
// Using playwright-core + @sparticuz/chromium for Vercel compatibility
import type { Browser, BrowserContext } from 'playwright-core';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;
    const { chromium } = await import('playwright-core');
    if (isLambda) {
      const chromiumPkg = await import('@sparticuz/chromium');
      const chromiumDefault = chromiumPkg.default;
      return await chromium.launch({
        args: chromiumDefault.args,
        executablePath: await chromiumDefault.executablePath(),
        headless: true,
      });
    } else {
      // Local: use full playwright (must be installed as dev dep)
      try {
        const localPlaywright = await import('playwright');
        return await localPlaywright.chromium.launch({ headless: true });
      } catch {
        return await chromium.launch({ headless: true });
      }
    }
  })();
  return browserPromise;
}

export async function getBrowserContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-TW',
  });
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close().catch(() => {});
    browserPromise = null;
  }
}
