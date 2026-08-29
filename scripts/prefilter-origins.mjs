// Prune outer stations before the expensive multi-city sweep.
//
// A four-segment ticket is only worth pricing if the outer city actually has a
// direct flight to/from TPE on that date. One cheap one-way direct-only search
// per (city, date) removes every multi-city combination built on a dead city —
// with 30 Japanese airports that is 900 seg1xseg4 pairs before dates, so the
// prefilter is worth ~2 orders of magnitude.
//
// Usage:
//   node scripts/prefilter-origins.mjs --input probes.jsonl --output kept.jsonl [--concurrency 3]
//     [--carriers 長榮航空,中華航空,星宇航空]
//
// Each input line: {"city":"NRT","date":"2026-12-23","direction":"to-tpe"}
//   direction to-tpe   = segment 1 (city -> TPE)
//   direction from-tpe = segment 4 (TPE -> city)
// Each output line adds: ok, directCarriers, keep, url, durationMs

import { chromium } from 'playwright-core';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { argv, exit } from 'process';
import { scrapeOne, createWarmContext } from './local-scrape.mjs';

const DEFAULT_CARRIERS = ['長榮航空', '中華航空', '星宇航空'];

function parseArgs(av) {
  const args = {};
  for (let i = 2; i < av.length; i++) {
    if (!av[i].startsWith('--')) continue;
    args[av[i].slice(2)] = av[i + 1];
    i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(argv);
  if (!args.input || !args.output) {
    console.error('Usage: --input <jsonl> --output <jsonl> [--concurrency 3] [--carriers a,b,c]');
    exit(1);
  }
  const concurrency = parseInt(args.concurrency || '3', 10);
  const carriers = (args.carriers ? args.carriers.split(',') : DEFAULT_CARRIERS)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!existsSync(dirname(args.output))) mkdirSync(dirname(args.output), { recursive: true });

  const probes = readFileSync(args.input, 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

  console.error(`prefilter: ${probes.length} probes, concurrency ${concurrency}`);
  console.error(`accepting direct flights on: ${carriers.join(' / ')}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const queue = [...probes];
  let done = 0;
  let kept = 0;
  const started = Date.now();

  const workers = Array.from({ length: concurrency }, async (_, w) => {
    let ctx;
    try {
      ctx = await createWarmContext(browser);
    } catch (e) {
      console.error(`[w${w}] warm failed: ${e.message}`);
      return;
    }
    while (queue.length) {
      const probe = queue.shift();
      if (!probe) break;
      const from = probe.direction === 'from-tpe' ? 'TPE' : probe.city;
      const to = probe.direction === 'from-tpe' ? probe.city : 'TPE';
      let row;
      try {
        const r = await scrapeOne(ctx, [{ from, to, date: probe.date }], 'economy', { directOnly: true });
        // scrapeOne's airline sidebar also lists transfer counts and transit
        // cities, so match the carrier names exactly rather than substring.
        const names = (r.prices || []).map((p) => p.airline);
        const directCarriers = carriers.filter((c) => names.includes(c));
        row = { ...probe, ok: r.ok, directCarriers, keep: directCarriers.length > 0, url: r.url, durationMs: r.durationMs };
      } catch (e) {
        // Treat an errored probe as "keep" — never drop a city because our
        // scraper glitched; a false keep only costs one wasted multi-city pass.
        row = { ...probe, ok: false, error: String(e).slice(0, 200), directCarriers: [], keep: true };
      }
      if (row.keep) kept++;
      appendFileSync(args.output, JSON.stringify(row) + '\n');
      done++;
      if (done % 10 === 0 || done === probes.length) {
        const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
        console.error(`[w${w}] ${done}/${probes.length} kept=${kept} elapsed=${elapsed}s rate=${(done / elapsed).toFixed(2)}/s`);
      }
    }
    await ctx.close().catch(() => {});
  });

  await Promise.all(workers);
  await browser.close();
  console.error(`prefilter done: ${kept}/${probes.length} kept`);
}

main().catch((e) => { console.error('fatal:', e); exit(1); });
