import { NextResponse } from 'next/server';
import { scrapePricesFromUrl } from '@/lib/scraper/eztravel-real';
import type { FlightSegmentSpec } from '@/types';

export const maxDuration = 120;

function fmtEzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return encodeURIComponent(`${d}/${m}/${y}`);
}

function buildMultiCityUrl(segments: FlightSegmentSpec[], cabin: 'economy' | 'business'): string {
  const segParams = segments
    .map((s, i) => {
      const fromAp = s.from.toUpperCase();
      const toAp = s.to.toUpperCase();
      const n = i + 1;
      return `dcity${n}=${fromAp}&acity${n}=${toAp}&date${n}=${fmtEzDate(s.date)}&dport${n}=${fromAp}&aport${n}=${toAp}`;
    })
    .join('&');
  const firstFrom = segments[0].from.toUpperCase();
  const firstTo = segments[0].to.toUpperCase();
  return `https://flight.eztravel.com.tw/tickets-multicity-${firstFrom}-${firstTo}/?${segParams}&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}`;
}

interface Body {
  segments: FlightSegmentSpec[];
  cabin?: 'economy' | 'business';
}

export async function POST(req: Request) {
  if (req.headers.get('x-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json()) as Body;
  if (!body.segments || body.segments.length !== 4) {
    return NextResponse.json({ error: 'pass {segments: 4}' }, { status: 400 });
  }
  const cabin = body.cabin ?? 'economy';
  const url = buildMultiCityUrl(body.segments, cabin);
  const start = Date.now();
  try {
    const prices = await scrapePricesFromUrl(url);
    return NextResponse.json({
      ok: true,
      cabin,
      url,
      prices,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json(
      { error: err, url, cabin, durationMs: Date.now() - start },
      { status: 500 }
    );
  }
}
