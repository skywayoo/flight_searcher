import { NextResponse } from 'next/server';
import { getFlightTarget, getFlightResults, createFlightResult, updateFlightTarget } from '@/lib/notion';
import { scrapeTarget } from '@/lib/scraper';
import { notifyPriceChange } from '@/lib/telegram';
import type { FlightCombination } from '@/types';

// Vercel function timeout: scraping can take a while
export const maxDuration = 300; // 5 min (Pro plan)

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const target = await getFlightTarget(id);
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    const start = Date.now();
    let top5: FlightCombination[] = [];
    let scrapeError: string | undefined;
    try {
      top5 = await scrapeTarget(target);
    } catch (e) {
      scrapeError = e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 8).join('\n')}` : String(e);
    }
    const durationMs = Date.now() - start;
    if (scrapeError) {
      return NextResponse.json({ error: scrapeError, durationMs }, { status: 500 });
    }

    const cheapest = top5[0]?.totalPrice ?? 0;
    const today = new Date().toISOString().split('T')[0];

    // If no flights found, only update lastScrapeAt — don't store a 0 result
    // and don't trigger notifications (so we don't spam "100% drop" alerts).
    if (cheapest === 0 || top5.length === 0) {
      await updateFlightTarget(id, { lastScrapeAt: today });
      return NextResponse.json({ cheapest: 0, count: 0, durationMs, skipped: 'no flights' });
    }

    // Compare to previous result (only against meaningful prev prices)
    const prevResults = await getFlightResults(id, 5);
    const prevValid = prevResults.find((r) => r.cheapestPrice > 0);
    const prev = prevValid?.cheapestPrice;
    const changePct = prev ? (cheapest - prev) / prev : undefined;

    await createFlightResult({
      targetId: id,
      scrapeDate: today,
      cheapestPrice: cheapest,
      prevCheapestPrice: prev,
      changePct,
      top5,
      source: 'eztravel',
      scrapeDurationMs: durationMs,
    });

    await updateFlightTarget(id, { lastScrapeAt: today });

    // Telegram: only on real price drops, not first-scan-with-data
    if (prev && changePct !== undefined) {
      const dropThreshold = -((target.notifyDropPct ?? 5) / 100);
      if (changePct <= dropThreshold) {
        await notifyPriceChange(target, cheapest, prev, changePct, top5[0]);
      }
    }

    return NextResponse.json({ cheapest, count: top5.length, durationMs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
