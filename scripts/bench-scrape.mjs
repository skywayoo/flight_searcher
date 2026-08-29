// Benchmark harness for flight_searcher's scraper.
// Times eztravel vs trip.com per task and records the cheapest price from each,
// so we can see (a) where the wall time goes and (b) whether skipping trip.com
// when eztravel is already over budget would lose real hits.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
import {
  scrapeOne, scrapeTrip, createWarmContext, createTripContext,
} from './local-scrape.mjs';

const TASKS = JSON.parse(process.env.BENCH_TASKS);
const LABEL = process.env.BENCH_LABEL || 'baseline';
const BLOCK = process.env.BENCH_BLOCK === '1';
const OUT = process.env.BENCH_OUT;

// Resource classes that never affect the price text we parse.
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
async function applyBlocking(ctx) {
  if (!BLOCK) return;
  await ctx.route('**/*', (route) => {
    if (BLOCKED_TYPES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });
}

const min = (prices) => (prices && prices.length ? Math.min(...prices.map((p) => p.price)) : null);

async function run() {
  const t0 = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const warmStart = Date.now();
  const ezCtx = await createWarmContext(browser);
  const warmMs = Date.now() - warmStart;
  const tripCtx = await createTripContext(browser);
  await applyBlocking(ezCtx);
  await applyBlocking(tripCtx);

  const rows = [];
  for (const task of TASKS) {
    const a = Date.now();
    const ez = await scrapeOne(ezCtx, task.segments, task.cabin);
    const ezMs = Date.now() - a;
    const b = Date.now();
    const tr = await scrapeTrip(tripCtx, task.segments, task.cabin);
    const trMs = Date.now() - b;
    const row = {
      route: task.segments.map((s) => s.from + '>' + s.to).join(' '),
      d1: task.segments[0].date,
      ezMs, trMs,
      ezMin: min(ez.prices), trMin: min(tr.prices),
      ezN: ez.prices?.length ?? 0, trN: tr.prices?.length ?? 0,
      ezOk: ez.ok, trOk: tr.ok,
      ezErr: ez.error || null, trErr: tr.error || null,
    };
    rows.push(row);
    console.log(
      `${row.route}  ez=${String(ezMs).padStart(6)}ms min=${String(row.ezMin ?? '-').padStart(7)} (${row.ezN})` +
      `   trip=${String(trMs).padStart(6)}ms min=${String(row.trMin ?? '-').padStart(7)} (${row.trN})`
    );
  }

  await browser.close();
  const totalMs = Date.now() - t0;

  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const summary = {
    label: LABEL, blocking: BLOCK, tasks: rows.length,
    warmMs, totalMs,
    ezTotalMs: sum((r) => r.ezMs), trTotalMs: sum((r) => r.trMs),
    ezAvgMs: Math.round(sum((r) => r.ezMs) / rows.length),
    trAvgMs: Math.round(sum((r) => r.trMs) / rows.length),
    ezPriced: rows.filter((r) => r.ezMin).length,
    trPriced: rows.filter((r) => r.trMin).length,
  };
  console.log('\nSUMMARY', JSON.stringify(summary));
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
}

run().catch((e) => { console.error('bench fatal:', e); process.exit(1); });
