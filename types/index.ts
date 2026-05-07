// ============ Flight Target ============
export type TripType = 'round_trip' | 'one_way' | 'multi_city_4';

export type TargetStatus = 'active' | 'paused';

export interface FlightTarget {
  id: string;
  name: string;                // user-given label e.g. "暑假東京"
  tripType: TripType;
  departureAirport: string;    // IATA, e.g. "TPE"
  region: string;              // RegionKey e.g. "日本", "東南亞"
  // optional: limit to specific airports within the region; empty = all
  destinationAirports: string[];
  // Date range for outbound search
  outboundStart: string;       // ISO date
  outboundEnd: string;         // ISO date
  // For round-trip: trip length min/max in days
  tripLengthMin?: number;
  tripLengthMax?: number;
  // For multi_city_4: list of out-stations to try (default: common cheap ones)
  outStations?: string[];
  // Optional budget cap (TWD)
  budgetCap?: number;
  // Also fetch business class for comparison
  includeBusiness?: boolean;
  // Notification thresholds
  notifyDropPct?: number;      // notify if price drops by this % (default 5)
  status: TargetStatus;
  createdAt: string;
  lastScrapeAt?: string;
}

// ============ Flight Result ============
export interface FlightCombination {
  totalPrice: number;          // TWD
  currency: string;            // 'TWD'
  outStation?: string;         // for multi_city_4
  outboundDate: string;
  returnDate?: string;
  outboundAirport: string;     // destination airport for outbound
  airline: string;
  cabin: 'economy' | 'business';
  segments: FlightSegment[];
  weekdayDays: number;         // count of weekdays in trip (Mon-Fri)
  source: 'eztravel';
  bookingUrl?: string;
  bookingUrls?: { skyscanner?: string; eztravel?: string };
}

export interface FlightSegment {
  from: string;
  to: string;
  departTime: string;          // ISO datetime
  arriveTime: string;
  airline: string;
  flightNo: string;
  duration: string;            // human readable e.g. "5h 30m"
  stops: number;
}

export interface FlightResult {
  id: string;
  targetId: string;
  scrapeDate: string;          // ISO date
  cheapestPrice: number;
  top5: FlightCombination[];
  prevCheapestPrice?: number;
  changePct?: number;
  source: 'eztravel';
  scrapeDurationMs?: number;
}
