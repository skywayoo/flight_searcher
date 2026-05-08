#!/usr/bin/env python3
"""Generate a static HTML report from data/flight-results.sqlite.

Outputs:
  public-static/index.html
  public-static/results.json (full data, in case user wants raw)

Drops the Next.js app for viewing; the static folder can be deployed to Vercel
as a pure CDN-served site (no functions, no Active CPU).
"""
import json
import os
import sqlite3
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "flight-results.sqlite")
OUT_DIR = os.path.join(ROOT, "public-static")


HTML = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flight Searcher · 4-segment NZ deals</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 16px;
    background: #0a0a0a; color: #e5e5e5;
    font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  h1 { font-size: 18px; margin: 8px 0 4px; }
  .meta { font-size: 12px; color: #888; margin-bottom: 16px; }
  .filter { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter label {
    background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
    padding: 6px 10px; cursor: pointer; user-select: none;
  }
  .filter input { vertical-align: -1px; margin-right: 4px; }
  .card {
    display: block;
    background: #181818; border-radius: 10px; padding: 12px 14px;
    margin-bottom: 8px; text-decoration: none; color: inherit;
  }
  .card:hover { background: #222; }
  .top { display: flex; justify-content: space-between; gap: 12px; }
  .name { font-weight: 600; color: #fff; }
  .price { font-size: 18px; font-weight: 700; color: #fff; white-space: nowrap; }
  .sub { font-size: 12px; color: #888; margin-top: 4px; }
  .badge { display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
  .b-econ { background: #053; color: #6f6; }
  .b-biz  { background: #503; color: #f6c; }
  .b-hit  { background: #c80; color: #000; font-weight: 600; }
  .stats { font-size: 11px; color: #666; margin-bottom: 12px; }
  .empty { color: #666; text-align: center; padding: 32px; }
</style>
</head>
<body>
  <h1>✈️ Flight Searcher</h1>
  <div class="meta" id="meta"></div>
  <div class="stats" id="stats"></div>
  <div class="filter">
    <label><input type="checkbox" id="f-hit" checked>只看 hits（≤$50k經/$80k商）</label>
    <label><input type="checkbox" id="f-econ" checked>經濟艙</label>
    <label><input type="checkbox" id="f-biz" checked>商務艙</label>
  </div>
  <div id="list"></div>

<script>
const data = __DATA__;
document.getElementById('meta').textContent =
  `更新於 ${data.generatedAt} · ${data.totalScrapes} scrapes (${data.priced} 有價, ${data.empty} 空, ${data.errored} 錯誤)`;

function fmt(n) { return n.toLocaleString('zh-TW'); }

function render() {
  const onlyHit = document.getElementById('f-hit').checked;
  const showEcon = document.getElementById('f-econ').checked;
  const showBiz = document.getElementById('f-biz').checked;

  const econCap = 50000, bizCap = 80000;
  // Group by (out1, out4, cabin) → cheapest
  const best = {};
  for (const r of data.results) {
    if (r.cheapest_price == null) continue;
    if (r.cabin === 'economy' && !showEcon) continue;
    if (r.cabin === 'business' && !showBiz) continue;
    const key = `${r.out1}|${r.out4}|${r.cabin}`;
    if (!best[key] || r.cheapest_price < best[key].cheapest_price) best[key] = r;
  }
  let rows = Object.values(best);
  if (onlyHit) {
    rows = rows.filter(r =>
      (r.cabin === 'economy' && r.cheapest_price <= econCap) ||
      (r.cabin === 'business' && r.cheapest_price <= bizCap)
    );
  }
  rows.sort((a, b) => a.cheapest_price - b.cheapest_price);

  const list = document.getElementById('list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">沒有符合條件的結果</div>';
    return;
  }
  list.innerHTML = rows.map(r => {
    const cap = r.cabin === 'economy' ? econCap : bizCap;
    const isHit = r.cheapest_price <= cap;
    const cabinBadge = r.cabin === 'economy' ? '<span class="badge b-econ">經濟</span>' : '<span class="badge b-biz">商務</span>';
    const hitBadge = isHit ? '<span class="badge b-hit">HIT</span>' : '';
    const dates = `${r.seg1_date} → ZQN ${r.seg2_date} · ${r.seg3_date} → ${r.out4} ${r.seg4_date}`;
    return `<a class="card" href="${r.booking_url}" target="_blank" rel="noopener">
      <div class="top">
        <div>
          <div class="name">${cabinBadge}${hitBadge}${r.out1}-ZQN-TPE-${r.out4}</div>
          <div class="sub">${dates}</div>
        </div>
        <div class="price">$${fmt(r.cheapest_price)}</div>
      </div>
    </a>`;
  }).join('');

  document.getElementById('stats').textContent = `顯示 ${rows.length} 個 pair`;
}

document.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', render));
render();
</script>
</body>
</html>
"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB)
    cur = conn.execute("""
        SELECT out1, out4, variation_idx, cabin,
               seg1_date, seg2_date, seg3_date, seg4_date,
               cheapest_price, booking_url, error
        FROM scrape_results
    """)
    rows = []
    for o1, o4, vi, cab, d1, d2, d3, d4, p, url, err in cur.fetchall():
        rows.append({
            "out1": o1, "out4": o4, "v": vi, "cabin": cab,
            "seg1_date": d1, "seg2_date": d2, "seg3_date": d3, "seg4_date": d4,
            "cheapest_price": p, "booking_url": url, "error": err,
        })
    cur = conn.execute("""
        SELECT
          COUNT(*) total,
          SUM(CASE WHEN cheapest_price IS NOT NULL THEN 1 ELSE 0 END) priced,
          SUM(CASE WHEN cheapest_price IS NULL AND error IS NULL THEN 1 ELSE 0 END) empty,
          SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) errored
        FROM scrape_results
    """)
    total, priced, empty, errored = cur.fetchone()

    payload = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "totalScrapes": total,
        "priced": priced,
        "empty": empty,
        "errored": errored,
        "results": rows,
    }
    out_html = HTML.replace("__DATA__", json.dumps(payload, ensure_ascii=False))
    with open(os.path.join(OUT_DIR, "index.html"), "w") as f:
        f.write(out_html)
    with open(os.path.join(OUT_DIR, "results.json"), "w") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT_DIR}/index.html ({len(out_html)//1024} KB)")
    print(f"wrote {OUT_DIR}/results.json")


if __name__ == "__main__":
    main()
