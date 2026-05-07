import { FlightCombination, TripType } from '@/types';

export interface SearchParams {
  from: string;
  to: string;
  outboundStart: string;
  outboundEnd: string;
  tripType: TripType;
  tripLengthMin?: number;
  tripLengthMax?: number;
  outStations?: string[];
}

// 平日天數計算（週一到週五）
function countWeekdays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  let count = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

/**
 * Scrape one search query from eztravel.
 *
 * NOTE: Currently returns stub data. Real Playwright-based implementation
 * needs to handle Incapsula JS challenge + form filling + result parsing.
 * The form selectors are known (#search-flight-depart-0 etc.) but parsing
 * the React-rendered results page is non-trivial and being iterated on.
 */
export async function scrapeOneSearch(params: SearchParams): Promise<FlightCombination[]> {
  // TODO: Replace with real scrape. For now, return stub data so end-to-end flow works.
  if (process.env.SCRAPER_MODE === 'real') {
    return await scrapeReal(params);
  }
  return generateStub(params);
}

function generateStub(params: SearchParams): FlightCombination[] {
  // Generate plausible mock data so UI/Telegram/cron can be tested
  const basePrice: Record<string, number> = {
    NRT: 12000, HND: 13000, KIX: 11000, FUK: 13500, CTS: 16000, OKA: 9000,
    ICN: 9500, PUS: 12000,
    HKG: 6000, MFM: 5500,
    BKK: 9000, SIN: 12000, KUL: 10000, MNL: 7000, SGN: 8500, HAN: 9500,
    LAX: 35000, JFK: 42000, SFO: 36000,
    LHR: 38000, CDG: 39000, FRA: 36000,
    SYD: 28000, AKL: 32000,
  };
  const base = basePrice[params.to] ?? 15000;
  const isMulti = params.tripType === 'multi_city_4';
  const isOneWay = params.tripType === 'one_way';

  const startD = new Date(params.outboundStart);
  const endD = new Date(params.outboundEnd);
  const dayDiff = Math.max(1, Math.floor((endD.getTime() - startD.getTime()) / 86400000));

  return Array.from({ length: 3 }, (_, i) => {
    const offset = Math.floor(Math.random() * (dayDiff + 1));
    const outDate = new Date(startD);
    outDate.setDate(outDate.getDate() + offset);
    const outDateStr = outDate.toISOString().split('T')[0];

    const tripLen = params.tripLengthMin
      ? params.tripLengthMin + Math.floor(Math.random() * ((params.tripLengthMax ?? params.tripLengthMin) - params.tripLengthMin + 1))
      : 7;
    const retDate = new Date(outDate);
    retDate.setDate(retDate.getDate() + tripLen);
    const retDateStr = retDate.toISOString().split('T')[0];

    const priceMultiplier = isOneWay ? 0.6 : isMulti ? 0.8 : 1.0;
    const price = Math.round((base + (Math.random() - 0.5) * base * 0.3) * priceMultiplier);

    const airlines = ['長榮航空', '中華航空', '星宇航空', '日本航空', '全日空', '台灣虎航'];
    const airline = airlines[Math.floor(Math.random() * airlines.length)];

    return {
      totalPrice: price,
      currency: 'TWD',
      outStation: isMulti ? (params.outStations?.[Math.floor(Math.random() * (params.outStations?.length || 1))] ?? 'HKG') : undefined,
      outboundDate: outDateStr,
      returnDate: isOneWay ? undefined : retDateStr,
      outboundAirport: params.to,
      airline,
      segments: [],
      weekdayDays: isOneWay ? countWeekdays(outDateStr, outDateStr) : countWeekdays(outDateStr, retDateStr),
      source: 'eztravel' as const,
      bookingUrl: `https://flight.eztravel.com.tw/`,
    };
  });
}

async function scrapeReal(_params: SearchParams): Promise<FlightCombination[]> {
  // Stub: real Playwright implementation pending
  // Will be implemented once UI/cron flow is verified working
  return [];
}
