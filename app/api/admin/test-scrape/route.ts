import { NextResponse } from 'next/server';
import { scrapePricesFromUrl, type ScrapeDebug } from '@/lib/scraper/eztravel-real';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get('x-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'pass ?url=...' }, { status: 400 });

  const debug: ScrapeDebug[] = [];
  const start = Date.now();
  try {
    const prices = await scrapePricesFromUrl(url, debug);
    return NextResponse.json({ ok: true, prices, debug, durationMs: Date.now() - start });
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}` : String(e);
    return NextResponse.json({ error: err, debug, durationMs: Date.now() - start }, { status: 500 });
  }
}
