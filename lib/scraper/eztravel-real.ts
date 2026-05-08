// Real eztravel scraper using Playwright
import { openBrowser, closeHandle } from './playwright-runtime';
import type { FlightCombination, FlightSegmentSpec } from '@/types';

interface AirlinePrice {
  airline: string;
  price: number;
}

function fmtEzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return encodeURIComponent(`${d}/${m}/${y}`);
}

// Use airport codes directly — eztravel accepts both airport and city codes;
// airport codes give more precise results (per user preference).
const cityMap: Record<string, string> = {};

function buildMultiCityUrl(segments: FlightSegmentSpec[], cabin: 'economy' | 'business'): string {
  const segParams = segments
    .map((s, i) => {
      const fromAp = s.from.toUpperCase();
      const toAp = s.to.toUpperCase();
      const fromCity = cityMap[fromAp] ?? fromAp;
      const toCity = cityMap[toAp] ?? toAp;
      const n = i + 1;
      const dport = fromCity !== fromAp ? '' : fromAp;
      const aport = toCity !== toAp ? '' : toAp;
      return `dcity${n}=${fromCity}&acity${n}=${toCity}&date${n}=${fmtEzDate(s.date)}&dport${n}=${dport}&aport${n}=${aport}`;
    })
    .join('&');
  const firstFrom = (cityMap[segments[0].from.toUpperCase()] ?? segments[0].from.toUpperCase());
  const firstTo = (cityMap[segments[0].to.toUpperCase()] ?? segments[0].to.toUpperCase());
  return `https://flight.eztravel.com.tw/tickets-multicity-${firstFrom}-${firstTo}/?${segParams}&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}`;
}

function buildRoundTripUrl(from: string, to: string, outDate: string, retDate: string, cabin: 'economy' | 'business'): string {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  return `https://flight.eztravel.com.tw/tickets-roundtrip-${f}-${t}/?outbounddate=${fmtEzDate(outDate)}&inbounddate=${fmtEzDate(retDate)}&dport=&aport=&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}&airline=`;
}

function buildOneWayUrl(from: string, to: string, outDate: string, cabin: 'economy' | 'business'): string {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  return `https://flight.eztravel.com.tw/tickets-oneway-${f}-${t}/?outbounddate=${fmtEzDate(outDate)}&dport=&aport=&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}&airline=`;
}

function countWeekdays(start: string, end: string): number {
  const s = new Date(start), e = new Date(end);
  let count = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

/**
 * Visit an eztravel result page and extract per-airline cheapest prices.
 * Returns sorted list (cheapest first). Empty array if no results.
 */
interface ScrapeDebug {
  step: string;
  bodyLen?: number;
  hasNoResults?: boolean;
  hasTwd?: boolean;
  finalUrl?: string;
  title?: string;
  airlineCount?: number;
}

async function scrapePricesFromUrl(url: string, debug?: ScrapeDebug[]): Promise<AirlinePrice[]> {
  const handle = await openBrowser();
  const page = await handle.context.newPage();
  try {
    debug?.push({ step: 'load homepage' });
    await page.goto('https://flight.eztravel.com.tw/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    debug?.push({ step: 'navigate to result url' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(15000);

    let bodyText = await page.evaluate(() => document.body.innerText);
    // If results aren't rendered yet (no "TWD" string and no "no results" message),
    // give the SPA up to 15 more seconds before declaring empty.
    if (!bodyText.includes('TWD') && !bodyText.includes('沒有符合的結果')) {
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(3000);
        bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('TWD') || bodyText.includes('沒有符合的結果')) break;
      }
    }
    debug?.push({
      step: 'after wait',
      bodyLen: bodyText.length,
      hasNoResults: bodyText.includes('沒有符合的結果'),
      hasTwd: bodyText.includes('TWD'),
      finalUrl: page.url(),
      title: await page.title(),
    });
    if (bodyText.includes('沒有符合的結果')) return [];

    // Extract airlines from the airline filter group only.
    // Filter section has header "航空公司"; we scope to that group.
    const airlines = await page.evaluate(() => {
      const out: { airline: string; price: number }[] = [];
      const seen = new Set<string>();
      // Find filter-group divs and locate the one containing "航空公司"
      const groups = document.querySelectorAll('.filter-group, [class*="filter-group"]');
      let airlineGroup: Element | null = null;
      for (const g of Array.from(groups)) {
        const txt = (g as HTMLElement).innerText || '';
        if (/^航空公司/.test(txt) || txt.startsWith('航空公司')) {
          airlineGroup = g;
          break;
        }
      }
      const root = airlineGroup ?? document;
      const checkboxes = root.querySelectorAll('label.el-checkbox span.el-checkbox__label');
      for (const el of Array.from(checkboxes)) {
        const text = (el as HTMLElement).innerText || '';
        const m = text.match(/^(.+?)\s+TWD\s*([\d,]+)/);
        if (!m) continue;
        const name = m[1].trim();
        // Filter out non-airline matches: airport names (機場), 全選, etc.
        if (name === '全選' || name.includes('機場') || name.includes('航廈') || name.length < 2) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const price = parseInt(m[2].replace(/,/g, ''), 10);
        if (price > 0) out.push({ airline: name, price });
      }
      return out;
    });

    debug?.push({ step: 'parsed airlines', airlineCount: airlines.length });
    return airlines.sort((a, b) => a.price - b.price);
  } finally {
    await page.close().catch(() => {});
    await closeHandle(handle);
  }
}

export { scrapePricesFromUrl, type ScrapeDebug };

export async function scrapeMultiCityReal(
  segments: FlightSegmentSpec[],
  cabin: 'economy' | 'business' = 'economy',
): Promise<FlightCombination[]> {
  if (segments.length !== 4) return [];

  // Try a few date variations per segment to find cheapest combo.
  // Each scrape ~30s; we do 3 attempts × 2 cabins = ~180s, within Vercel 5min timeout.
  function shiftDate(iso: string, days: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
  // 3 date variations with per-segment offsets to test different trip lengths.
  // Each scan ~25s × 3 dates × 2 cabins = ~150s.
  // Format: { o1, o2 (out NZ), o3 (ret NZ), o4 (TPE-out) }
  const variations = [
    { o1: 0,  o2: 0,  o3: 0,  o4: 0  },   // base: 3/1, 4/1, 4/12, 4/30 (12d NZ)
    { o1: 1,  o2: -2, o3: 3,  o4: -9 },   // user $43k: 3/2, 3/30, 4/15, 4/21 (16d NZ)
    { o1: -3, o2: 4,  o3: 4,  o4: 1  },   // 2/26, 4/5, 4/16, 5/1 (12d NZ)
  ];

  let prices: AirlinePrice[] = [];
  let bestUrl = buildMultiCityUrl(segments, cabin);
  let bestPrice = Infinity;
  let bestSegments = segments;

  for (const v of variations) {
    const tried = [
      { ...segments[0], date: shiftDate(segments[0].date, v.o1) },
      { ...segments[1], date: shiftDate(segments[1].date, v.o2) },
      { ...segments[2], date: shiftDate(segments[2].date, v.o3) },
      { ...segments[3], date: shiftDate(segments[3].date, v.o4) },
    ];
    const url = buildMultiCityUrl(tried, cabin);
    const result = await scrapePricesFromUrl(url);
    if (result.length > 0) {
      const cheapest = result[0].price;
      if (cheapest < bestPrice) {
        bestPrice = cheapest;
        prices = result;
        bestUrl = url;
        bestSegments = tried;
      }
    }
  }

  if (prices.length === 0) return [];
  segments = bestSegments;

  const tripStart = segments[1].date || segments[0].date;
  const tripEnd = segments[2].date || segments[3].date;
  const route = segments.map((s) => `${s.from}→${s.to}`).join(' / ');

  return prices.slice(0, 8).map((ap) => ({
    totalPrice: ap.price,
    currency: 'TWD',
    outStation: segments[0].from,
    outboundDate: tripStart,
    returnDate: tripEnd,
    outboundAirport: segments[1].to,
    airline: `${ap.airline} (${route})`,
    cabin,
    segments: [],
    weekdayDays: countWeekdays(tripStart, tripEnd),
    source: 'eztravel' as const,
    bookingUrl: bestUrl,
    bookingUrls: { eztravel: bestUrl },
  }));
}

export async function scrapeRoundTripReal(
  from: string,
  to: string,
  outDate: string,
  retDate: string,
  cabin: 'economy' | 'business' = 'economy',
): Promise<FlightCombination[]> {
  const url = buildRoundTripUrl(from, to, outDate, retDate, cabin);
  const prices = await scrapePricesFromUrl(url);
  if (prices.length === 0) return [];
  return prices.slice(0, 5).map((ap) => ({
    totalPrice: ap.price,
    currency: 'TWD',
    outboundDate: outDate,
    returnDate: retDate,
    outboundAirport: to,
    airline: ap.airline,
    cabin,
    segments: [],
    weekdayDays: countWeekdays(outDate, retDate),
    source: 'eztravel' as const,
    bookingUrl: url,
    bookingUrls: { eztravel: url },
  }));
}

export async function scrapeOneWayReal(
  from: string,
  to: string,
  outDate: string,
  cabin: 'economy' | 'business' = 'economy',
): Promise<FlightCombination[]> {
  const url = buildOneWayUrl(from, to, outDate, cabin);
  const prices = await scrapePricesFromUrl(url);
  if (prices.length === 0) return [];
  return prices.slice(0, 5).map((ap) => ({
    totalPrice: ap.price,
    currency: 'TWD',
    outboundDate: outDate,
    outboundAirport: to,
    airline: ap.airline,
    cabin,
    segments: [],
    weekdayDays: countWeekdays(outDate, outDate),
    source: 'eztravel' as const,
    bookingUrl: url,
    bookingUrls: { eztravel: url },
  }));
}
