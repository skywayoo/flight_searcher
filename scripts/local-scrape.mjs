// Local Playwright scraper. Reads task list from CLI/stdin, scrapes eztravel
// in parallel, prints JSON results to stdout. No Vercel involved.
//
// Usage:
//   node scripts/local-scrape.mjs --input tasks.jsonl --concurrency 4 --output results.jsonl
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
    console.error('Usage: --input <jsonl> --output <jsonl> [--concurrency 4]');
    exit(1);
  }
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

  // Worker pool. Each worker holds its own warmed context — visiting the
  // homepage once at startup lets Incapsula set anti-bot cookies that the
  // result URLs need.
  const queue = [...tasks];
  const workers = Array.from({ length: concurrency }, async (_, w) => {
    let ctx;
    try {
      ctx = await createWarmContext(browser);
    } catch (e) {
      console.error(`[w${w}] failed to warm context: ${e.message}`);
      return;
    }
    while (queue.length) {
      const task = queue.shift();
      if (!task) break;
      const t0 = Date.now();
      try {
        const result = await scrapeOne(ctx, task.segments, task.cabin);
        appendFileSync(output, JSON.stringify({ ...task, ...result }) + '\n');
      } catch (e) {
        appendFileSync(output, JSON.stringify({
          ...task,
          ok: false,
          error: String(e).slice(0, 200),
          durationMs: Date.now() - t0,
        }) + '\n');
      }
      completed++;
      if (completed % 10 === 0 || completed === tasks.length) {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        const rate = completed / elapsed;
        const eta = Math.floor((tasks.length - completed) / rate);
        console.error(`[w${w}] ${completed}/${tasks.length} elapsed=${elapsed}s eta=${eta}s rate=${rate.toFixed(2)}/s`);
      }
    }
    await ctx.close().catch(() => {});
  });

  await Promise.all(workers);
  await browser.close();
  console.error('done');
}

main().catch((e) => {
  console.error('fatal:', e);
  exit(1);
});
