import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get('x-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const start = Date.now();
  const log: string[] = [];
  try {
    log.push(`isVercel=${!!process.env.VERCEL} isLambda=${!!process.env.AWS_LAMBDA_FUNCTION_NAME}`);
    log.push(`SCRAPER_MODE=${process.env.SCRAPER_MODE}`);
    log.push(`cwd=${process.cwd()}`);

    // Try to list node_modules/@sparticuz/chromium
    const fs = await import('fs');
    try {
      const dirs = ['/var/task/node_modules/@sparticuz/chromium', '/var/task/node_modules/@sparticuz', '/var/task/node_modules'];
      for (const d of dirs) {
        try {
          const list = fs.readdirSync(d).slice(0, 20).join(', ');
          log.push(`${d}: [${list}]`);
        } catch (e: unknown) {
          log.push(`${d}: ERR ${(e as Error).message}`);
        }
      }
    } catch (e) {
      log.push(`fs check err: ${e}`);
    }

    const t1 = Date.now();
    const { chromium } = await import('playwright-core');
    log.push(`import playwright-core: ${Date.now() - t1}ms`);

    const t2 = Date.now();
    const chromiumPkg = await import('@sparticuz/chromium');
    log.push(`import @sparticuz/chromium: ${Date.now() - t2}ms`);

    const t3 = Date.now();
    const execPath = await chromiumPkg.default.executablePath('https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar');
    log.push(`executablePath: ${execPath}, took ${Date.now() - t3}ms`);

    const t4 = Date.now();
    const browser = await chromium.launch({
      args: chromiumPkg.default.args,
      executablePath: execPath,
      headless: true,
    });
    log.push(`launch: ${Date.now() - t4}ms`);

    const t5 = Date.now();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    log.push(`example.com title: "${title}", took ${Date.now() - t5}ms`);

    await browser.close();
    log.push(`total: ${Date.now() - start}ms`);
    return NextResponse.json({ ok: true, log });
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 8).join('\n')}` : String(e);
    return NextResponse.json({ error: err, log, durationMs: Date.now() - start }, { status: 500 });
  }
}
