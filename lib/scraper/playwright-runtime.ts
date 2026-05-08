// Playwright runtime: each scrape gets a fresh browser (no caching, so
// multiple scrapes in same Lambda warm instance don't share closed contexts).
import type { Browser, BrowserContext } from 'playwright-core';
import { promises as fs } from 'fs';
import path from 'path';

const REMOTE_CHROMIUM_TAR = 'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar';

export interface BrowserHandle {
  browser: Browser;
  context: BrowserContext;
}

// Clean up /tmp to avoid ENOSPC on warm Lambda instances.
// Keep the extracted chromium binary (saves 50s cold-start), nuke everything else.
async function cleanTempDirs(): Promise<void> {
  try {
    const tmp = '/tmp';
    const entries = await fs.readdir(tmp);
    const targets = entries.filter((e) => {
      // keep chromium binary + its extraction artifacts
      if (/^chromium/i.test(e)) return false;
      if (/^_pack/.test(e)) return false;
      if (e === 'al2' || e === 'al2023') return false;
      // delete everything playwright-related
      return /^playwright/.test(e) || /^chrome_url_fetcher/.test(e) ||
             /^puppeteer/.test(e) || /-profile-/.test(e) || /-artifacts-/.test(e);
    });
    await Promise.all(
      targets.map((e) => fs.rm(path.join(tmp, e), { recursive: true, force: true }).catch(() => {}))
    );
  } catch {
    // ignore
  }
}

async function launchBrowser(): Promise<Browser> {
  await cleanTempDirs();
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
  // Best-effort cleanup so the next invocation has fresh /tmp space
  await cleanTempDirs();
}
