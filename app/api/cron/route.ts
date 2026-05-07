import { NextResponse } from 'next/server';
import { getFlightTargets } from '@/lib/notion';

export const maxDuration = 300;

export async function GET(req: Request) {
  // Auth check
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const targets = await getFlightTargets();
  const active = targets.filter((t) => t.status === 'active');
  const origin = req.headers.get('origin') || `https://${req.headers.get('host')}`;

  // Trigger scans sequentially (each scan has its own 5min timeout)
  // We fire-and-forget so this cron returns immediately
  const triggered: string[] = [];
  for (const t of active) {
    fetch(`${origin}/api/targets/${t.id}/scan`, {
      method: 'POST',
      headers: { 'x-cron-trigger': '1' },
    }).catch(() => {});
    triggered.push(t.id);
  }

  return NextResponse.json({ triggered: triggered.length });
}
