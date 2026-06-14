import { NextResponse } from 'next/server';
import { createFlightTarget } from '@/lib/notion';
import { isVercel } from '@/lib/guard';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = await createFlightTarget({
      name: body.name,
      tripType: body.tripType,
      departureAirport: body.departureAirport,
      region: body.region,
      destinationAirports: body.destinationAirports || [],
      outboundStart: body.outboundStart,
      outboundEnd: body.outboundEnd,
      tripLengthMin: body.tripLengthMin,
      tripLengthMax: body.tripLengthMax,
      segments: body.segments,
      outStations: body.outStations,
      budgetCap: body.budgetCap,
      budgetCapEcon: body.budgetCapEcon,
      budgetCapBusiness: body.budgetCapBusiness,
      includeBusiness: body.includeBusiness,
      notifyDropPct: body.notifyDropPct,
      status: body.status || 'active',
    });
    // Trigger immediate scan in background (fire and forget) — LOCAL ONLY.
    // On Vercel the scan endpoint is disabled (view-only), so don't even fire it.
    if (!isVercel) {
      fetch(`${req.headers.get('origin') || ''}/api/targets/${id}/scan`, {
        method: 'POST',
      }).catch(() => {/* ignore — scan will happen in local batch anyway */});
    }
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
