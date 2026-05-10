#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DB_PATH = path.join(ROOT, "data", "flight-results.sqlite");
const ENV_PATH = path.join(ROOT, ".env.local");
const REGIONS_PATH = path.join(ROOT, "lib", "regions.ts");
const TELEGRAM_LIMIT = 3500;

async function main() {
  const env = await loadEnvFile(ENV_PATH);
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }

  const airportMap = await loadAirportMap(REGIONS_PATH);
  const pairRows = querySql(`
    with ranked as (
      select
        id,
        out1,
        out4,
        nz,
        seg4_airport,
        seg4_date,
        variation_idx,
        cabin,
        cheapest_price,
        scraped_at,
        row_number() over (
          partition by out1, out4
          order by case when cheapest_price > 0 then 0 else 1 end, cheapest_price asc, id asc
        ) as rn
      from scrape_results
    )
    select id, out1, out4, nz, seg4_airport, seg4_date, variation_idx, cabin, cheapest_price, scraped_at
    from ranked
    where rn = 1
    order by out1, out4;
  `);

  const priced = pairRows
    .filter((row) => Number(row.cheapest_price) > 0)
    .sort((left, right) => left.cheapest_price - right.cheapest_price || left.id - right.id);
  const missing = pairRows.filter((row) => !Number(row.cheapest_price));

  const winStats = querySql(`
    with ranked as (
      select
        out1,
        out4,
        nz,
        seg4_airport,
        seg4_date,
        variation_idx,
        cabin,
        cheapest_price,
        row_number() over (
          partition by out1, out4
          order by case when cheapest_price > 0 then 0 else 1 end, cheapest_price asc, id asc
        ) as rn
      from scrape_results
    )
    select nz, seg4_airport, seg4_date, variation_idx, cabin, count(*) as wins
    from ranked
    where rn = 1 and cheapest_price > 0
    group by nz, seg4_airport, seg4_date, variation_idx, cabin
    order by wins desc, nz, seg4_airport, seg4_date, variation_idx, cabin;
  `);

  const bestOrigins = querySql(`
    with ranked as (
      select
        out1,
        out4,
        cheapest_price,
        row_number() over (
          partition by out1, out4
          order by case when cheapest_price > 0 then 0 else 1 end, cheapest_price asc, id asc
        ) as rn
      from scrape_results
    )
    select
      out1,
      count(*) as priced_pairs,
      round(avg(cheapest_price), 0) as avg_best_price,
      min(cheapest_price) as min_best_price
    from ranked
    where rn = 1 and cheapest_price > 0
    group by out1
    order by avg_best_price asc, out1
    limit 8;
  `);

  const missingByOrigin = groupMissingByOrigin(missing);
  const summary = buildSummary({
    priced,
    missing,
    airportMap,
    winStats,
    bestOrigins,
    missingByOrigin,
  });

  const pricedMessages = chunkLines(
    "flight_searcher 最低價總表（每個 out1->out4 最低有效價）",
    priced.map((row, index) => formatPricedLine(row, airportMap, index + 1)),
  );

  const missingMessages = chunkLines(
    "flight_searcher 缺價格組合（按出發點分組）",
    formatMissingLines(missingByOrigin, airportMap),
  );

  await sendTelegram(token, chatId, summary);
  for (const message of pricedMessages) {
    await sendTelegram(token, chatId, message);
  }
  for (const message of missingMessages) {
    await sendTelegram(token, chatId, message);
  }

  console.log(JSON.stringify({
    summarySent: true,
    pricedMessages: pricedMessages.length,
    missingMessages: missingMessages.length,
    pricedPairs: priced.length,
    missingPairs: missing.length,
  }, null, 2));
}

async function loadEnvFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/u)) {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\\n/gu, "").replace(/\\r/gu, "");
  }

  return env;
}

async function loadAirportMap(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const map = new Map();

  for (const match of raw.matchAll(/\{ code: '([A-Z]+)', city: '([^']+)'/gu)) {
    map.set(match[1], match[2]);
  }

  return map;
}

function querySql(sql) {
  return JSON.parse(execFileSync("sqlite3", ["-json", DB_PATH, sql], { encoding: "utf8" }));
}

function buildSummary({ priced, missing, airportMap, winStats, bestOrigins, missingByOrigin }) {
  const topWin = winStats[0];
  const secondWin = winStats[1];

  return [
    "flight_searcher 濃縮報告",
    `- 機場對總數：${priced.length + missing.length}`,
    `- 有價格：${priced.length}`,
    `- 缺價格：${missing.length}`,
    topWin ? `- 最常勝出配置：${topWin.nz} / ${topWin.seg4_airport} ${topWin.seg4_date} / v${topWin.variation_idx} / ${topWin.cabin} (${topWin.wins} 組)` : null,
    secondWin ? `- 次常勝出配置：${secondWin.nz} / ${secondWin.seg4_airport} ${secondWin.seg4_date} / v${secondWin.variation_idx} / ${secondWin.cabin} (${secondWin.wins} 組)` : null,
    "",
    "最便宜前 5 組：",
    ...priced.slice(0, 5).map((row) => `- ${formatAirport(row.out1, airportMap)} -> ${formatAirport(row.out4, airportMap)} $${formatPrice(row.cheapest_price)} (${row.seg4_airport} ${row.seg4_date})`),
    "",
    "平均最低價最漂亮的出發點：",
    ...bestOrigins.map((row) => `- ${formatAirport(row.out1, airportMap)} avg $${formatPrice(row.avg_best_price)} / min $${formatPrice(row.min_best_price)} / ${row.priced_pairs} 組`),
    "",
    "缺價格最多的出發點：",
    ...missingByOrigin.slice(0, 8).map(({ out1, out4List }) => `- ${formatAirport(out1, airportMap)} 缺 ${out4List.length} 組`),
    "",
    "怎樣配比較好：",
    "- 先看 economy，當前最低價幾乎都由 economy 勝出。",
    "- `ZQN-CHC` 若搭配 `TSA` 回外站，第三段回國當天或隔天都值得檢查。",
    "- 缺口集中在 `DMK / GMP / SHI / CTS`，要補掃先從這些起點下手。",
  ].filter(Boolean).join("\n");
}

function formatPricedLine(row, airportMap, index) {
  return `${index}. ${formatAirport(row.out1, airportMap)} -> ${formatAirport(row.out4, airportMap)} $${formatPrice(row.cheapest_price)} [${row.cabin} ${row.nz} ${row.seg4_airport} ${row.seg4_date} v${row.variation_idx}]`;
}

function groupMissingByOrigin(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const out4List = grouped.get(row.out1) || [];
    out4List.push(row.out4);
    grouped.set(row.out1, out4List);
  }

  return [...grouped.entries()]
    .map(([out1, out4List]) => ({
      out1,
      out4List: [...new Set(out4List)].sort(),
    }))
    .sort((left, right) => right.out4List.length - left.out4List.length || left.out1.localeCompare(right.out1));
}

function formatMissingLines(missingByOrigin, airportMap) {
  return missingByOrigin.map(({ out1, out4List }) => {
    return `- ${formatAirport(out1, airportMap)} 缺：${out4List.map((code) => formatAirport(code, airportMap)).join(", ")}`;
  });
}

function chunkLines(title, lines) {
  const messages = [];
  let current = title;

  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length > TELEGRAM_LIMIT) {
      messages.push(current);
      current = `${title}\n${line}`;
    } else {
      current = next;
    }
  }

  if (current !== title) {
    messages.push(current);
  }

  return messages;
}

function formatAirport(code, airportMap) {
  return `${code}${airportMap.has(code) ? ` ${airportMap.get(code)}` : ""}`;
}

function formatPrice(value) {
  return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

async function sendTelegram(token, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
