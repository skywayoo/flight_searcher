import { FlightTarget, FlightCombination } from '@/types';
import { getRegionAirports, getAirportByCode, OUT_STATIONS } from '@/lib/regions';
import { scrapeOneSearch } from './eztravel';

// How many destination airports to actually try in one scan
// (each destination = ~30-60s on real scraper, so cap to control cost)
const MAX_DESTINATIONS_PER_SCAN = 6;

export async function scrapeTarget(target: FlightTarget): Promise<FlightCombination[]> {
  const allAirports = getRegionAirports(target.region);

  // Filter to user-selected destinations or use all
  const destinations = target.destinationAirports.length > 0
    ? allAirports.filter((a) => target.destinationAirports.includes(a.code))
    : allAirports;

  // Cap to control runtime
  const targetDests = destinations.slice(0, MAX_DESTINATIONS_PER_SCAN);

  const allResults: FlightCombination[] = [];

  const cabins: Array<'economy' | 'business'> = target.includeBusiness ? ['economy', 'business'] : ['economy'];

  for (const dest of targetDests) {
    for (const cabin of cabins) {
      try {
        const results = await scrapeOneSearch({
          from: target.departureAirport,
          to: dest.code,
          outboundStart: target.outboundStart,
          outboundEnd: target.outboundEnd,
          tripType: target.tripType,
          tripLengthMin: target.tripLengthMin,
          tripLengthMax: target.tripLengthMax,
          outStations: target.tripType === 'multi_city_4' ? (target.outStations ?? OUT_STATIONS.map((o) => o.code)) : undefined,
          cabin,
        });
        allResults.push(...results);
      } catch (e) {
        console.error(`scrape failed for ${dest.code} ${cabin}:`, e);
      }
      // small delay between requests
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
    }
  }

  // Filter by budget if set (apply only to economy; business class always shown if requested)
  let filtered = allResults;
  if (target.budgetCap) {
    filtered = filtered.filter((r) => r.cabin === 'business' || r.totalPrice <= target.budgetCap!);
  }

  // Sort by price ascending. Take top 5 economy + top 3 business (if any).
  const economy = filtered.filter((r) => r.cabin !== 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 5);
  const business = filtered.filter((r) => r.cabin === 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 3);
  return [...economy, ...business];
}
