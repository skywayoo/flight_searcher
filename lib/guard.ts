import { NextResponse } from 'next/server';

/**
 * Scraping (playwright/chromium) must run ONLY on the user's local machine,
 * never on Vercel — heavy 2GB/long-running functions blow the Hobby quota and
 * paused the whole team before. Vercel deployment is view-only.
 *
 * Vercel sets process.env.VERCEL='1' automatically in its runtime; it is unset
 * during local `npm run dev` and in the standalone local-scrape scripts.
 * Returns a 403 response when on Vercel, or null to proceed (local).
 */
export function blockScrapeOnVercel(): NextResponse | null {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'Scraping is disabled on Vercel (view-only). Run the scraper locally.' },
      { status: 403 }
    );
  }
  return null;
}

/** True when running on Vercel (so callers can skip firing scans). */
export const isVercel = !!process.env.VERCEL;
