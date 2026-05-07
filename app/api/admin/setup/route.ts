import { NextResponse } from 'next/server';
import { createTargetDb, createResultDb } from '@/lib/notion';

/**
 * One-time setup: create the two Notion databases inside a parent page.
 *
 * Usage:
 *   POST /api/admin/setup
 *   {
 *     "secret": "<CRON_SECRET>",
 *     "parentPageId": "<notion page id where DBs should live>"
 *   }
 *
 * The Notion integration must already be invited to the parent page.
 * Returns the two DB IDs to set as env vars.
 */
export async function POST(req: Request) {
  const body = await req.json();
  if (body.secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parent = body.parentPageId;
  if (!parent) return NextResponse.json({ error: 'parentPageId required' }, { status: 400 });

  try {
    const targetsDbId = await createTargetDb(parent);
    const resultsDbId = await createResultDb(parent);
    return NextResponse.json({
      NOTION_FLIGHT_TARGETS_DB_ID: targetsDbId,
      NOTION_FLIGHT_RESULTS_DB_ID: resultsDbId,
      message: 'Add these to Vercel env vars and redeploy',
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
