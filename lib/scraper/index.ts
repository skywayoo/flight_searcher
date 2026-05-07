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

  for (const dest of targetDests) {
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
      });
      allResults.push(...results);
    } catch (e) {
      console.error(`scrape failed for ${dest.code}:`, e);
    }
    // small delay between destinations
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
  }

  // Filter by budget if set
  let filtered = allResults;
  if (target.budgetCap) {
    filtered = filtered.filter((r) => r.totalPrice <= target.budgetCap!);
  }

  // Sort by price ascending and take top 5
  filtered.sort((a, b) => a.totalPrice - b.totalPrice);
  return filtered.slice(0, 5);
}
