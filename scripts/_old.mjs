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
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
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

function buildOneWayUrl(from, to, date, cabin) {
  // Single-segment via multicity URL pattern — eztravel accepts 1-segment
  // multicity and renders the same airline price list.
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  return `https://flight.eztravel.com.tw/tickets-multicity-${f}-${t}/?dcity1=${f}&acity1=${t}&date1=${fmtEzDate(date)}&dport1=${f}&aport1=${t}&adults=1&children=0&infants=0&direct=false&cabintype=${cabin === 'business' ? 'business' : 'any'}`;
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

async function createTripContext(browser) {
  // Trip.com mobile uses wholetext attribute for prices (anti-scrape).
  // Mobile UA + small viewport triggers the mobile flightfirst page which shows bundle totals.
  return browser.newContext({
    viewport: { width: 414, height: 896 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    locale: 'zh-TW',
  });
}

async function scrapeTrip(ctx, segments, cabin) {
  const url = buildTripMobileUrl(segments, cabin);
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait up to 25s for prices to render
    let waited = 0;
    let foundPrice = false;
    while (waited < 25000) {
      foundPrice = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[wholetext]')).some((el) =>
          /TWD[\d,]+/.test(el.getAttribute('wholetext') || '')
        );
      });
      if (foundPrice) break;
      await page.waitForTimeout(1000);
      waited += 1000;
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

async function scrapeOne(ctx, segments, cabin) {
  const url = segments.length === 1
    ? buildOneWayUrl(segments[0].from, segments[0].to, segments[0].date, cabin)
    : buildMultiCityUrl(segments, cabin);
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Adaptive wait: poll every 300ms, bail at 12s.
    let bodyText = '';
    const startWait = Date.now();
    while (Date.now() - startWait < 12000) {
      bodyText = await page.evaluate(() => document.body.innerText);
      if (bodyText.includes('TWD') || bodyText.includes('沒有符合的結果')) break;
      await page.waitForTimeout(300);
    }
    if (bodyText.includes('沒有符合的結果')) {
      return { ok: true, prices: [], url, durationMs: Date.now() - t0 };
    }

    const airlines = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const groups = document.querySelectorAll('.filter-group, [class*="filter-group"]');
      let airlineGroup = null;
      for (const g of Array.from(groups)) {
        const txt = g.innerText || '';
        if (/^航空公司/.test(txt) || txt.startsWith('航空公司')) { airlineGroup = g; break; }
      }
      const root = airlineGroup ?? document;
      const checkboxes = root.querySelectorAll('label.el-checkbox span.el-checkbox__label');
      for (const el of Array.from(checkboxes)) {
        const text = el.innerText || '';
        const m = text.match(/^(.+?)\s+TWD\s*([\d,]+)/);
        if (!m) continue;
        const name = m[1].trim();
        if (name === '全選' || name.includes('機場') || name.includes('航廈') || name.length < 2) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const price = parseInt(m[2].replace(/,/g, ''), 10);
        if (price > 0) out.push({ airline: name, price });
      }
      return out;
    });

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
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
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

  const tasks = readFileSync(input, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  console.error(`tasks: ${tasks.length}, concurrency: ${concurrency}`);
  console.error('launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  let completed = 0;
  const started = Date.now();

  // Worker pool. Each worker holds the contexts required by the selected
  // sources. Per task, emit one JSONL line for each requested source.
  const queue = [...tasks];
  // Rotate contexts every CONTEXT_ROTATE tasks to avoid Node heap OOM —
  // playwright contexts accumulate cookies/storage/listeners that the V8 GC
  // can't reclaim between page.close() calls. Previously crashed at ~1620
  // tasks/worker × 4 workers with 'Ineffective mark-compacts near heap limit'.
  const CONTEXT_ROTATE = parseInt(process.env.CONTEXT_ROTATE || '150', 10);
  const workers = Array.from({ length: concurrency }, async (_, w) => {
    let ezCtx, tripCtx;
    let sinceRotate = 0;
    async function makeContexts() {
      if (useEztravel) ezCtx = await createWarmContext(browser);
      if (useTrip) tripCtx = await createTripContext(browser);
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
      if (useEztravel) {
        const t0 = Date.now();
        try {
          const result = await scrapeOne(ezCtx, task.segments, task.cabin);
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
      if (useTrip) {
        const t1 = Date.now();
        try {
          const result = await scrapeTrip(tripCtx, task.segments, task.cabin);
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
      completed++;
      sinceRotate++;
      if (completed % 10 === 0 || completed === tasks.length) {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        const rate = completed / elapsed;
        const eta = Math.floor((tasks.length - completed) / rate);
        const mem = process.memoryUsage();
        const rssMb = Math.round(mem.rss / 1024 / 1024);
        const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
        console.error(`[w${w}] ${completed}/${tasks.length} elapsed=${elapsed}s eta=${eta}s rate=${rate.toFixed(2)}/s rss=${rssMb}MB heap=${heapMb}MB`);
      }
    }
    await ezCtx?.close().catch(() => {});
    await tripCtx?.close().catch(() => {});
  });

  await Promise.all(workers);
  await browser.close();
  console.error('done');
}

main().catch((e) => {
  console.error('fatal:', e);
  exit(1);
});
