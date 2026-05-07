import { NextResponse } from 'next/server';
import { getFlightTarget, getFlightResults, createFlightResult, updateFlightTarget } from '@/lib/notion';
import { scrapeTarget } from '@/lib/scraper';
import { notifyPriceChange } from '@/lib/telegram';

// Vercel function timeout: scraping can take a while
export const maxDuration = 300; // 5 min (Pro plan)

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const target = await getFlightTarget(id);
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    const start = Date.now();
    const top5 = await scrapeTarget(target);
    const durationMs = Date.now() - start;

    const cheapest = top5[0]?.totalPrice ?? 0;

    // Compare to previous result
    const prevResults = await getFlightResults(id, 1);
    const prev = prevResults[0]?.cheapestPrice;
    const changePct = prev ? (cheapest - prev) / prev : undefined;

    const today = new Date().toISOString().split('T')[0];
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

    // Telegram notification if significant drop or new low
    if (prev && changePct !== undefined) {
      const dropThreshold = -((target.notifyDropPct ?? 5) / 100);
      if (changePct <= dropThreshold || cheapest < prev) {
        await notifyPriceChange(target, cheapest, prev, changePct, top5[0]);
      }
    } else if (!prev && cheapest > 0) {
      await notifyPriceChange(target, cheapest, undefined, undefined, top5[0]);
    }

    return NextResponse.json({ cheapest, count: top5.length, durationMs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
