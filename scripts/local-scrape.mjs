// Local Playwright scraper. Reads task list from CLI/stdin, scrapes eztravel
// in parallel, prints JSON results to stdout. No Vercel involved.
//
// Usage:
//   node scripts/local-scrape.mjs --input tasks.jsonl --concurrency 4 --output results.jsonl
//   --sources eztravel|trip.com|both  (default: both; comma-separated to combine)
//
// Each input line includes out1/out4/nz/seg4 metadata plus segments.
// Each output line preserves that metadata and adds scrape result fields.

import { chromium } from 'playwright-core';
import { readFileSync, appendFileSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { argv, exit } from 'process';

function fmtEzDate(iso) {
  const [y, m, d] = iso.split('-');
  return encodeURIComponent(`${d}/${m}/${y}`);
}

function buildMultiCityUrl(segments, cabin) {
  const segParams = segments.map((s, i) => {
    const fromAp = s.from.toUpperCase();
    const toAp = s.to.toUpperCase();
    const n = i + 1;
    return `dcity${n}=${fromAp}&acity${n}=${toAp}&date${n}=${fmtEzDate(s.date)}&dport${n}=${fromAp}&aport${n}=${toAp}`;
  }).join('&');
  const firstFrom = segments[0].from.toUpperCase();
  const firstTo = segments[0].to.toUpperCase();
  return `https://flight.eztravel.com.tw/tickets-multicity-${firstFrom}-${firstTo}/?${segParams}&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}`;
}

function buildOneWayUrl(from, to, date, cabin, directOnly = false) {
  // Must use the tickets-oneway- path. The multicity path with a single
  // segment loads the search form but never populates from/to, so eztravel
  // answers every such query with 查無可訂航班 regardless of the route.
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  return `https://flight.eztravel.com.tw/tickets-oneway-${f}-${t}/?dcity1=${f}&acity1=${t}&date1=${fmtEzDate(date)}&dport1=${f}&aport1=${t}&adults=1&children=0&infants=0&direct=${directOnly}&cabintype=${cabin === 'business' ? 'business' : 'any'}`;
}

// ============================================================
// Trip.com mobile multi-city URL + scraper
// ============================================================
function buildTripMobileUrl(segs, cabin) {
  // cabin: 0=經濟、1=豪華經濟、2=商務、3=頭等
  const cabinCode = cabin === 'business' ? 2 : 0;
  const p = new URLSearchParams();
  segs.forEach((s, i) => {
    const idx = i === 0 ? '' : String(i);  // 0-based: seg1=no suffix, seg2=1, seg3=2, seg4=3
    p.set(`dcitycode${idx}`, s.from.toUpperCase());
    p.set(`acitycode${idx}`, s.to.toUpperCase());
    p.set(`ddate${idx}`, s.date);
  });
  p.set('segs', String(segs.length));
  p.set('triptype', '2');           // multi-city
  p.set('classtype', String(cabinCode));
  p.set('classgroupsearch', 'true');
  p.set('adult', '1');
  p.set('from', 'flighthome');
  p.set('locale', 'zh-tw');
  p.set('curr', 'TWD');
  return `https://tw.trip.com/m/flights/flightfirst/?${p}`;
}

// Never affect the price text we parse, but dominate the bytes and the
// decode/layout work. Dropping them cut trip.com's wall time by ~33% in
// scripts/bench-scrape.mjs. Deliberately NOT applied to the eztravel context:
// that one sits behind Incapsula and is flaky enough without perturbing what
// its anti-bot JS sees load.
const SKIPPABLE_RESOURCES = new Set(['image', 'media', 'font']);

async function createTripContext(browser) {
  // Trip.com mobile uses wholetext attribute for prices (anti-scrape).
  // Mobile UA + small viewport triggers the mobile flightfirst page which shows bundle totals.
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    locale: 'zh-TW',
  });
  await ctx.route('**/*', (route) => (
    SKIPPABLE_RESOURCES.has(route.request().resourceType())
      ? route.abort()
      : route.continue()
  ));
  return ctx;
}

async function scrapeTrip(ctx, segments, cabin) {
  const url = buildTripMobileUrl(segments, cabin);
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait up to 25s for prices to render. Benchmarks put first paint of a
    // price at 1.5–2.7s, so poll at 400ms rather than 1s — a full second of
    // idle waiting per task is the single largest avoidable cost here.
    let waited = 0;
    let foundPrice = false;
    while (waited < 25000) {
      foundPrice = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[wholetext]')).some((el) =>
          /TWD[\d,]+/.test(el.getAttribute('wholetext') || '')
        );
      });
      if (foundPrice) break;
      await page.waitForTimeout(400);
      waited += 400;
    }
    if (!foundPrice) {
      return { ok: true, source: 'trip.com', prices: [], url, durationMs: Date.now() - t0 };
    }
    // Extract prices from wholetext attributes (Trip.com renders price text via image-like span)
    const airlines = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const ailineRe = /(長榮航空|中華航空|大韓航空|樂桃|星宇|台灣虎航|酷航|越南航空|泰國航空|新加坡航空|國泰航空|日本航空|全日空|菲律賓航空|印尼鷹航|馬航|阿聯酋|卡達航空|土耳其航空|澳洲航空|紐西蘭航空|香港航空|澳門航空|海南航空|立榮航空|華信航空|聯合航空|達美航空|美國航空|加拿大航空|韓亞航空|濟州航空)/;
      document.querySelectorAll('[wholetext]').forEach((el) => {
        const raw = el.getAttribute('wholetext') || '';
        const m = raw.match(/TWD([\d,]+)/);
        if (!m) return;
        const p = parseInt(m[1].replace(/,/g, ''), 10);
        if (p < 5000 || p > 500000) return;
        if (seen.has(p)) return;
        seen.add(p);
        // Find airline name in same card
        let card = el.closest('div, li, article');
        let airline = '';
        let depth = 0;
        while (card && depth < 5) {
          const txt = card.innerText || '';
          const am = txt.match(ailineRe);
          if (am) { airline = am[1]; break; }
          card = card.parentElement;
          depth++;
        }
        out.push({ airline: airline || '?', price: p });
      });
      return out.sort((a, b) => a.price - b.price);
    });
    return {
      ok: true,
      source: 'trip.com',
      prices: airlines,
      url,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, source: 'trip.com', error: e.message?.slice(0, 200) || String(e), url, durationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}

async function createWarmContext(browser) {
  // eztravel sits behind Imperva Incapsula; the result URLs are blocked
  // until we visit the homepage and let the JS anti-bot challenge set
  // cookies. Each worker keeps one warmed context for its whole run.
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-TW',
  });
  const page = await ctx.newPage();
  try {
    await page.goto('https://flight.eztravel.com.tw/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Give Incapsula's challenge a moment to settle the cookies.
    await page.waitForTimeout(4000);
  } finally {
    await page.close().catch(() => {});
  }
  return ctx;
}

// eztravel says 查無可訂航班 for an empty route and 沒有符合的結果 when filters
// exclude everything. Matching only the second one made every dead route sit
// out the full 12s poll instead of returning immediately.
const NO_RESULT_RE = /查無可訂航班|沒有符合的結果/;

async function scrapeOne(ctx, segments, cabin, { directOnly = false } = {}) {
  const url = segments.length === 1
    ? buildOneWayUrl(segments[0].from, segments[0].to, segments[0].date, cabin, directOnly)
    : buildMultiCityUrl(segments, cabin);
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Poll for the parsed airline rows themselves. The previous predicate
    // broke as soon as the literal 'TWD' appeared anywhere in body text, but
    // the page chrome (currency selector) already contains it — so a page
    // whose results had not rendered yet was read as "no airlines" and the
    // whole route was scored empty. FUK/NGO->TPE reproduced this every time
    // while genuinely having daily BR/CI service.
    let airlines = [];
    let noResult = false;
    const startWait = Date.now();
    while (Date.now() - startWait < 12000) {
      const snap = await page.evaluate((noResultSrc) => {
        const out = [];
        const seen = new Set();
        const groups = document.querySelectorAll('.filter-group, [class*="filter-group"]');
        let airlineGroup = null;
        for (const g of Array.from(groups)) {
          const txt = g.innerText || '';
          if (/^航空公司/.test(txt)) { airlineGroup = g; break; }
        }
        const root = airlineGroup ?? document;
        for (const el of Array.from(root.querySelectorAll('label.el-checkbox span.el-checkbox__label'))) {
          const m = (el.innerText || '').match(/^(.+?)\s+TWD\s*([\d,]+)/);
          if (!m) continue;
          const name = m[1].trim();
          if (name === '全選' || name.includes('機場') || name.includes('航廈') || name.length < 2) continue;
          if (seen.has(name)) continue;
          seen.add(name);
          const price = parseInt(m[2].replace(/,/g, ''), 10);
          if (price > 0) out.push({ airline: name, price });
        }
        return { rows: out, noResult: new RegExp(noResultSrc).test(document.body.innerText || '') };
      }, NO_RESULT_RE.source);
      airlines = snap.rows;
      noResult = snap.noResult;
      if (airlines.length || noResult) break;
      await page.waitForTimeout(300);
    }
    if (!airlines.length) {
      return { ok: true, prices: [], url, durationMs: Date.now() - t0 };
    }
    return {
      ok: true,
      prices: airlines.sort((a, b) => a.price - b.price),
      url,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 200) || String(e), url, durationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    // A valueless flag such as --resume must not swallow the flag after it.
    if (v === undefined || v.startsWith('--')) {
      args[k] = true;
    } else {
      args[k] = v;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(argv);
  const input = args.input;
  const output = args.output;
  const concurrency = parseInt(args.concurrency || '4', 10);
  if (!input || !output) {
    console.error('Usage: --input <jsonl> --output <jsonl> [--concurrency 4] [--sources both]');
    console.error('       [--econ-cap 50000] [--biz-cap 80000] [--cap-margin 0.10] [--resume]');
    exit(1);
  }

  // Budget gate. Both sources already report the total fare for the whole
  // multi-city ticket on their first result page, so once the leading source
  // comes back over budget there is nothing to gain from loading the second
  // one. Benchmarked on 18 four-segment tasks: trip.com priced 18/18 at
  // ~1.9s/task, eztravel 5/18 at ~6.5s/task, and eztravel undercut trip.com in
  // 1 of 6 pairs by 3.5% — hence trip.com leads and the margin below keeps that
  // outlier reachable.
  const econCap = args['econ-cap'] ? parseInt(args['econ-cap'], 10) : null;
  const bizCap = args['biz-cap'] ? parseInt(args['biz-cap'], 10) : null;
  const capMargin = parseFloat(args['cap-margin'] ?? '0.10');
  if (Number.isNaN(capMargin) || capMargin < 0) {
    console.error(`--cap-margin: bad value ${JSON.stringify(args['cap-margin'])} (expected a number >= 0)`);
    exit(1);
  }

  // `--sources eztravel` is useful for a fast first-pass: eztravel's displayed
  // multicity fare is already the total for every segment in the ticket.
  // Validated before the browser launches so a typo fails fast instead of
  // scraping nothing and exiting 0.
  const ALL_SOURCES = ['eztravel', 'trip.com'];
  const requested = (args.sources || 'both')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = requested.includes('both') ? ALL_SOURCES : requested;
  const unknown = selected.filter((s) => !ALL_SOURCES.includes(s));
  if (unknown.length || !selected.length) {
    console.error(`--sources: bad value ${JSON.stringify(args.sources)} (valid: ${ALL_SOURCES.join(', ')}, both)`);
    exit(1);
  }
  const useEztravel = selected.includes('eztravel');
  const useTrip = selected.includes('trip.com');

  if (!existsSync(dirname(output))) mkdirSync(dirname(output), { recursive: true });

  let tasks = readFileSync(input, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  // Identity of a task as far as resuming is concerned: the itinerary plus the
  // cabin. Sources are separate output lines for the same task, so a task only
  // counts as done once every requested source has written a line for it.
  const taskKey = (t) => JSON.stringify([t.cabin, t.segments.map((g) => [g.from, g.to, g.date])]);

  if (args.resume !== undefined && existsSync(output)) {
    const seen = new Map();
    for (const line of readFileSync(output, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r.segments || !r.cabin) continue;
      const k = taskKey(r);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(r.source || 'eztravel');
    }
    const before = tasks.length;
    tasks = tasks.filter((t) => {
      const done = seen.get(taskKey(t));
      return !done || !selected.every((src) => done.has(src));
    });
    console.error(`resume: ${before - tasks.length} already in ${output}, ${tasks.length} left`);
  }

  console.error(`tasks: ${tasks.length}, concurrency: ${concurrency}`);
  console.error('launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  let completed = 0;
  let skippedOverCap = 0;
  const started = Date.now();

  // Worker pool. Each worker holds the contexts required by the selected
  // sources. Per task, emit one JSONL line for each requested source.
  const queue = [...tasks];
  // Rotate contexts every CONTEXT_ROTATE tasks to avoid Node heap OOM —
  // playwright contexts accumulate cookies/storage/listeners that the V8 GC
  // can't reclaim between page.close() calls. Previously crashed at ~1620
  // tasks/worker × 4 workers with 'Ineffective mark-compacts near heap limit'.
  const CONTEXT_ROTATE = parseInt(process.env.CONTEXT_ROTATE || '150', 10);
  const TRIP_EMPTY_STREAK = parseInt(process.env.TRIP_EMPTY_STREAK || '8', 10);
  // eztravel stops returning prices after roughly 1500-2500 requests on one
  // context: pages start coming back instantly and empty. Unlike trip.com's
  // block that survives a recycle, this one clears completely with a fresh
  // Incapsula warm-up, so a worker can recover itself. Only ~13% of itineraries
  // price even when healthy, so the threshold has to sit well above a normal
  // run of empties (25 in a row is p<0.03 when healthy).
  const EZ_EMPTY_STREAK = parseInt(process.env.EZ_EMPTY_STREAK || '25', 10);
  const workers = Array.from({ length: concurrency }, async (_, w) => {
    let ezCtx, tripCtx;
    let sinceRotate = 0;
    let tripEmptyStreak = 0;
    let ezEmptyStreak = 0;
    let ezRewarms = 0;
    let tripRecycled = false;
    let tripDisabled = false;
    async function makeContexts() {
      if (useTrip) tripCtx = await createTripContext(browser);
      // eztravel's context costs ~4.5s to warm past Incapsula and holds a
      // second set of cookies for the worker's whole life. With the budget
      // gate most tasks never reach eztravel, so pay that only on first use.
      ezCtx = null;
    }
    async function eztravelContext() {
      if (!ezCtx) ezCtx = await createWarmContext(browser);
      return ezCtx;
    }
    try {
      await makeContexts();
    } catch (e) {
      console.error(`[w${w}] failed to warm contexts: ${e.message}`);
      return;
    }
    while (queue.length) {
      const task = queue.shift();
      if (!task) break;
      // A long run of price-less trip.com pages means the session got throttled
      // rather than that every itinerary sold out — trip.com then costs the
      // full 25s wait per task AND stops feeding the budget gate, so the run
      // ends up slower than it was before the gate existed. First try fresh
      // cookies; if that doesn't bring prices back the block is above the
      // session (observed: recycling did not help), so stop paying the 25s and
      // finish the run on eztravel alone.
      if (!tripDisabled && tripEmptyStreak >= TRIP_EMPTY_STREAK * 2) {
        console.error(`[w${w}] trip.com still price-less after a context recycle — dropping it for the rest of this run`);
        tripDisabled = true;
      } else if (tripEmptyStreak >= TRIP_EMPTY_STREAK && !tripRecycled) {
        console.error(`[w${w}] ${tripEmptyStreak} price-less trip.com pages in a row — recycling context`);
        tripRecycled = true;
        sinceRotate = CONTEXT_ROTATE;
      }
      if (sinceRotate >= CONTEXT_ROTATE) {
        // Recycle contexts to free memory before next batch.
        await ezCtx?.close().catch(() => {});
        await tripCtx?.close().catch(() => {});
        try {
          await makeContexts();
        } catch (e) {
          console.error(`[w${w}] context rotate failed: ${e.message}`);
          break;
        }
        sinceRotate = 0;
        if (global.gc) global.gc();
      }
      // 1. trip.com leads — it is the faster and far more complete source.
      let tripMin = null;
      if (useTrip && !tripDisabled) {
        const t1 = Date.now();
        try {
          const result = await scrapeTrip(tripCtx, task.segments, task.cabin);
          tripMin = result.ok && result.prices?.length ? result.prices[0].price : null;
          tripEmptyStreak = tripMin === null ? tripEmptyStreak + 1 : 0;
          appendFileSync(output, JSON.stringify({ ...task, ...result }) + '\n');
        } catch (e) {
          appendFileSync(output, JSON.stringify({
            ...task,
            source: 'trip.com',
            ok: false,
            error: String(e).slice(0, 200),
            durationMs: Date.now() - t1,
          }) + '\n');
        }
      }

      // 2. eztravel only when the ticket might still land inside budget.
      // Per-task caps (stamped by the scanners from each target's own budget)
      // win over the run-wide --econ-cap/--biz-cap defaults. A cap of 0 or a
      // missing cap means "no budget set" — never gate those.
      const cap = task.cabin === 'business'
        ? (task.biz_cap || bizCap)
        : (task.econ_cap || econCap);
      const overCap = cap && tripMin !== null && tripMin > cap * (1 + capMargin);
      if (overCap) skippedOverCap++;
      if (useEztravel && !overCap) {
        if (ezEmptyStreak >= EZ_EMPTY_STREAK) {
          ezRewarms++;
          console.error(`[w${w}] ${ezEmptyStreak} price-less eztravel pages in a row — re-warming context (#${ezRewarms})`);
          await ezCtx?.close().catch(() => {});
          ezCtx = null;
          ezEmptyStreak = 0;
        }
        const t0 = Date.now();
        try {
          const result = await scrapeOne(await eztravelContext(), task.segments, task.cabin);
          ezEmptyStreak = result.ok && result.prices?.length ? 0 : ezEmptyStreak + 1;
          appendFileSync(output, JSON.stringify({ ...task, source: 'eztravel', ...result }) + '\n');
        } catch (e) {
          appendFileSync(output, JSON.stringify({
            ...task,
            source: 'eztravel',
            ok: false,
            error: String(e).slice(0, 200),
            durationMs: Date.now() - t0,
          }) + '\n');
        }
      }
      completed++;
      sinceRotate++;
      if (completed % 10 === 0 || completed === tasks.length) {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        const rate = completed / elapsed;
        const eta = Math.floor((tasks.length - completed) / rate);
        const mem = process.memoryUsage();
        const rssMb = Math.round(mem.rss / 1024 / 1024);
        const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
        console.error(`[w${w}] ${completed}/${tasks.length} elapsed=${elapsed}s eta=${eta}s rate=${rate.toFixed(2)}/s skipped=${skippedOverCap} rewarm=${ezRewarms} rss=${rssMb}MB heap=${heapMb}MB`);
      }
    }
    await ezCtx?.close().catch(() => {});
    await tripCtx?.close().catch(() => {});
  });

  await Promise.all(workers);
  await browser.close();
  console.error('done');
}

// Only run the batch when invoked directly, so benchmarks/tests can import
// the scrape helpers without kicking off a full run.
const invokedDirectly = argv[1] && realpathSync(argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error('fatal:', e);
    exit(1);
  });
}

export { scrapeOne, scrapeTrip, createWarmContext, createTripContext, buildMultiCityUrl, buildTripMobileUrl };
