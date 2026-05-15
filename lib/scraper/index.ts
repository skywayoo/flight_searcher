import { FlightTarget, FlightCombination } from '@/types';
import { getRegionAirports } from '@/lib/regions';
import { scrapeOneSearch, scrapeMultiCity } from './eztravel';
import { scrapeMultiCityReal, scrapeRoundTripReal, scrapeOneWayReal } from './eztravel-real';

const USE_REAL = process.env.SCRAPER_MODE === 'real';

// How many destination airports to actually try in one scan
const MAX_DESTINATIONS_PER_SCAN = 6;

export async function scrapeTarget(target: FlightTarget): Promise<FlightCombination[]> {
  const cabins: Array<'economy' | 'business'> = target.includeBusiness ? ['economy', 'business'] : ['economy'];
  const allResults: FlightCombination[] = [];

  // Multi-city: use user-defined segments, or synthesize from outStations + destination
  if (target.tripType === 'multi_city_4') {
    let segments = target.segments;
    if (!segments || segments.length !== 4) {
      // Synthesize: outStation→TPE / TPE→dest / dest→TPE / TPE→outStation
      const outStation = target.outStations?.[0] ?? 'HKG';
      const destAirports = target.destinationAirports.length > 0
        ? target.destinationAirports
        : getRegionAirports(target.region).slice(0, 1).map((a) => a.code);
      const dest = destAirports[0] ?? 'NRT';
      const home = target.departureAirport;
      const start = new Date(target.outboundStart);
      const end = new Date(target.outboundEnd);
      const total = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000));
      const tripLen = target.tripLengthMin ?? 7;
      // outbound = somewhere in middle of range; date1 (outstation→TPE) one day before outbound
      const outboundIdx = Math.max(1, Math.floor(total / 3));
      const outboundDate = new Date(start);
      outboundDate.setDate(outboundDate.getDate() + outboundIdx);
      const date1 = new Date(outboundDate);
      date1.setDate(date1.getDate() - 1);
      const date3 = new Date(outboundDate);
      date3.setDate(date3.getDate() + tripLen);
      const date4 = new Date(date3);
      date4.setDate(date4.getDate() + 1);
      const iso = (d: Date) => d.toISOString().split('T')[0];
      segments = [
        { from: outStation, to: home, date: iso(date1) },
        { from: home, to: dest, date: iso(outboundDate) },
        { from: dest, to: home, date: iso(date3) },
        { from: home, to: outStation, date: iso(date4) },
      ];
    }
    // Expand multi-airport segments (comma-separated from/to) into cartesian product.
    // Each entry in `segments` may carry comma-separated codes like "HKG,BKK"; we
    // generate one scrape per concrete (from,to,from,to...) combination.
    const expand = (s: string) => (s || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    type Combo = typeof segments;
    const combos: Combo[] = [];
    const rec = (i: number, acc: Combo) => {
      if (i === segments.length) { combos.push(acc.slice()); return; }
      const s = segments[i];
      const fs = expand(s.from);
      const ts = expand(s.to);
      const fromList = fs.length ? fs : [''];
      const toList = ts.length ? ts : [''];
      for (const f of fromList) for (const t of toList) {
        acc.push({ from: f, to: t, date: s.date, dateEnd: s.dateEnd });
        rec(i + 1, acc);
        acc.pop();
      }
    };
    rec(0, []);
    console.log(`[scrape] multi_city_4: ${combos.length} combos to scrape`);
    for (const combo of combos) {
      for (const cabin of cabins) {
        try {
          const results = USE_REAL
            ? await scrapeMultiCityReal(combo, cabin)
            : await scrapeMultiCity(combo, cabin);
          allResults.push(...results);
        } catch (e) {
          console.error('multi-city combo failed', combo.map((s) => `${s.from}→${s.to}`).join(','), e);
        }
        // Brief cool-off between scrapes; eztravel doesn't seem to rate-limit
        // for our volume on a single residential IP. Keep small but non-zero.
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      }
    }
  } else {
    // round_trip / one_way: iterate region's airports
    const allAirports = getRegionAirports(target.region);
    const destinations = target.destinationAirports.length > 0
      ? allAirports.filter((a) => target.destinationAirports.includes(a.code))
      : allAirports;
    const targetDests = destinations.slice(0, MAX_DESTINATIONS_PER_SCAN);

    for (const dest of targetDests) {
      for (const cabin of cabins) {
        try {
          let results: FlightCombination[];
          if (USE_REAL) {
            // Real scraper: use middle of date range as preferred date
            const start = new Date(target.outboundStart);
            const end = new Date(target.outboundEnd);
            const mid = new Date((start.getTime() + end.getTime()) / 2);
            const outIso = mid.toISOString().split('T')[0];
            if (target.tripType === 'one_way') {
              results = await scrapeOneWayReal(target.departureAirport, dest.code, outIso, cabin);
            } else {
              const tripLen = target.tripLengthMin ?? 7;
              const ret = new Date(mid);
              ret.setDate(ret.getDate() + tripLen);
              const retIso = ret.toISOString().split('T')[0];
              results = await scrapeRoundTripReal(target.departureAirport, dest.code, outIso, retIso, cabin);
            }
          } else {
            results = await scrapeOneSearch({
              from: target.departureAirport,
              to: dest.code,
              outboundStart: target.outboundStart,
              outboundEnd: target.outboundEnd,
              tripType: target.tripType,
              tripLengthMin: target.tripLengthMin,
              tripLengthMax: target.tripLengthMax,
              cabin,
            });
          }
          allResults.push(...results);
        } catch (e) {
          console.error(`scrape failed for ${dest.code} ${cabin}:`, e);
        }
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      }
    }
  }

  // Apply budget caps separately per cabin.
  // Priority: target.budgetCapEcon/Business > legacy target.budgetCap > BUSINESS_BUDGET_CAP env
  const businessCap = target.budgetCapBusiness
    ?? parseInt(process.env.BUSINESS_BUDGET_CAP ?? '70000', 10);
  const econCap = target.budgetCapEcon ?? target.budgetCap ?? Infinity;
  const filtered = allResults.filter((r) =>
    r.cabin === 'business' ? r.totalPrice <= businessCap : r.totalPrice <= econCap
  );

  const economy = filtered.filter((r) => r.cabin !== 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 5);
  const business = filtered.filter((r) => r.cabin === 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 3);
  return [...economy, ...business];
}
