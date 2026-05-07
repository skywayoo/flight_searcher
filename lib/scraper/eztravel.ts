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
  // Generate plausible mock RT-equivalent prices (one direction)
  // For round-trip we'll use 2 * base; for multi_city_4 we'll use whole 4-segment ticket price
  const baseOneWay: Record<string, number> = {
    // Northeast Asia
    NRT: 7500, HND: 8500, KIX: 7000, NGO: 8500, FUK: 8500, CTS: 11000, OKA: 6000, KMJ: 9500, HIJ: 10000, TAK: 10000,
    ICN: 6000, GMP: 6500, PUS: 7500, CJU: 8000, TAE: 8500,
    HKG: 4000, MFM: 3800,
    // Southeast Asia
    BKK: 6500, DMK: 6000, HKT: 8500, CNX: 7500, USM: 9500, KBV: 9000,
    SGN: 6500, HAN: 7000, DAD: 7500, CXR: 8500, PQC: 9000,
    SIN: 9000, KUL: 7500, PEN: 8500, BKI: 8000, KCH: 9500,
    CGK: 9000, DPS: 10000, SUB: 11000,
    MNL: 5500, CEB: 7500, CRK: 5500, KLO: 8500,
    PNH: 9500, REP: 9500, VTE: 12000, RGN: 13000,
    // South Asia
    DEL: 14000, BOM: 16000, MLE: 18000, KTM: 16000, CMB: 14000,
    // Oceania (long-haul)
    SYD: 22000, MEL: 23000, BNE: 21000, PER: 26000, AKL: 25000, CHC: 27000,
    // North America
    LAX: 24000, SFO: 24000, SEA: 23000, SAN: 26000, LAS: 27000, PDX: 25000, HNL: 18000,
    JFK: 30000, EWR: 30000, BOS: 32000, IAD: 30000, MIA: 32000, ATL: 31000, ORD: 28000,
    YVR: 22000, YYZ: 28000, YUL: 30000, YYC: 24000,
    // Europe
    LHR: 26000, LGW: 26000, CDG: 27000, ORY: 27000, AMS: 27000, BRU: 28000, DUB: 29000,
    FRA: 25000, MUC: 26000, BER: 28000, VIE: 28000, ZRH: 28000, PRG: 30000, BUD: 31000, WAW: 31000,
    FCO: 28000, MXP: 27000, VCE: 30000, BCN: 28000, MAD: 28000, LIS: 32000, ATH: 32000,
    CPH: 30000, ARN: 30000, OSL: 32000, HEL: 28000, KEF: 38000,
    // Middle East
    DXB: 16000, AUH: 16500, DOH: 17000, IST: 18000, TLV: 22000, AMM: 22000,
    // Latin America (very long)
    MEX: 38000, CUN: 40000, GRU: 45000, GIG: 45000, EZE: 50000, SCL: 48000, LIM: 42000,
    // Africa
    CAI: 26000, JNB: 36000, CPT: 38000, NBO: 32000, CMN: 35000,
  };
  const oneWay = baseOneWay[params.to] ?? 15000;
  const isMulti = params.tripType === 'multi_city_4';
  const isOneWay = params.tripType === 'one_way';

  // For 4-segment outstation tickets, total = ~4 segments worth, but with regional pricing
  // it ends up being ~1.5x the round-trip price (i.e. roughly 3x one-way)
  // Plus you still need to buy a separate TPE→outstation throwaway flight
  let priceMultiplier: number;
  if (isOneWay) priceMultiplier = 1.0;          // 1 segment
  else if (isMulti) priceMultiplier = 3.0;      // 4 segments at outstation pricing
  else priceMultiplier = 2.0;                   // round trip = 2 segments

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

    // ±15% noise per result
    const noise = 1 + (Math.random() - 0.5) * 0.3;
    const price = Math.round(oneWay * priceMultiplier * noise);

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
