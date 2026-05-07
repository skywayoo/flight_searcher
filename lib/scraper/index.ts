import { FlightTarget, FlightCombination } from '@/types';
import { getRegionAirports } from '@/lib/regions';
import { scrapeOneSearch, scrapeMultiCity } from './eztravel';

// How many destination airports to actually try in one scan
const MAX_DESTINATIONS_PER_SCAN = 6;

export async function scrapeTarget(target: FlightTarget): Promise<FlightCombination[]> {
  const cabins: Array<'economy' | 'business'> = target.includeBusiness ? ['economy', 'business'] : ['economy'];
  const allResults: FlightCombination[] = [];

  // Multi-city: use the user-defined segments directly, don't iterate destinations
  if (target.tripType === 'multi_city_4' && target.segments?.length === 4) {
    for (const cabin of cabins) {
      try {
        const results = await scrapeMultiCity(target.segments, cabin);
        allResults.push(...results);
      } catch (e) {
        console.error(`multi-city scrape failed (${cabin}):`, e);
      }
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
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
          const results = await scrapeOneSearch({
            from: target.departureAirport,
            to: dest.code,
            outboundStart: target.outboundStart,
            outboundEnd: target.outboundEnd,
            tripType: target.tripType,
            tripLengthMin: target.tripLengthMin,
            tripLengthMax: target.tripLengthMax,
            cabin,
          });
          allResults.push(...results);
        } catch (e) {
          console.error(`scrape failed for ${dest.code} ${cabin}:`, e);
        }
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      }
    }
  }

  let filtered = allResults;
  if (target.budgetCap) {
    filtered = filtered.filter((r) => r.cabin === 'business' || r.totalPrice <= target.budgetCap!);
  }

  const economy = filtered.filter((r) => r.cabin !== 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 5);
  const business = filtered.filter((r) => r.cabin === 'business').sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 3);
  return [...economy, ...business];
}
