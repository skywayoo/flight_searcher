#!/usr/bin/env python3
"""JSON-only flight scan orchestrator.

Replaces scan-targets-direct.py for users who do not want Notion/SQLite.
Input: data/my-targets.json (or path via --targets)
Output: data/results.json (append-only by default, or --reset to overwrite)

Range support per segment:
  from: ["TPE", "TSA"]                       multi-airport
  to:   ["NRT", "HND"]                       multi-destination
  date_range: { start: "...", end: "..." }   inclusive date range

The cartesian product of all (from × to × date) across segments is expanded
into individual scrape tasks, dispatched to local-scrape.mjs (Playwright +
chromium), and the cheapest in-budget result per (target, cabin, source) is
written to results.json.

Telegram notification is optional via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
in the environment (or .env.local). No external services required.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from airport_groups import AIRPORT_GROUPS, expand_airports  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NODE = os.environ.get("NODE20") or shutil.which("node") or "node"


def load_env_file(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def daterange(start_iso, end_iso):
    start = datetime.strptime(start_iso, "%Y-%m-%d")
    end = datetime.strptime(end_iso, "%Y-%m-%d")
    if end < start:
        raise ValueError(f"date_range end ({end_iso}) before start ({start_iso})")
    cur = start
    while cur <= end:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


class TooManyTasks(Exception):
    """Raised mid-expansion so a runaway target aborts instead of eating RAM.

    A four-segment target multiplies fast: 30 outer airports x 8 outbound dates
    x 42 New Zealand combinations x (30 x 5) return options x 2 cabins is over
    3 million tasks, which materialises to gigabytes before anything is scraped.
    """

    def __init__(self, name, built, cap):
        super().__init__(
            f"target {name!r} expands past --max-tasks ({built:,} > {cap:,}). "
            f"Narrow the airport groups, pin the New Zealand dates, or raise --max-tasks."
        )


def _group_of(code, candidates=None):
    """Which preset group an airport code came from.

    Used by from_pair_group / to_pair_group so "日本配日本、泰國配泰國" can be
    expressed without listing every pairing by hand. Pass `candidates` to limit
    the search to the groups a target actually cares about — several presets
    overlap (BKK is in both 泰國 and 東南亞主要) and a bare first-match would
    silently pair Bangkok with Singapore.
    """
    names = candidates if candidates else list(AIRPORT_GROUPS)
    for gname in names:
        codes = AIRPORT_GROUPS.get(gname, [])
        if code in codes:
            return gname, codes
    return None, [code]


def _resolve_pool(spec, field, chosen):
    """Airport options for one side of one segment.

    Supported keys (all optional, applied in this order):
      <field>                 explicit code or list of codes
      <field>_groups          preset group names from airport_groups.py
      <field>_pair_group      {"segment": n, "field": "from"} — reuse whichever
                              preset group segment n's airport was drawn from,
                              so the return leg stays in the same country
      <field>_exclude         {"segment": n, "field": "to"} — drop the airport
                              segment n already used, e.g. so New Zealand is
                              entered and left at different airports
    """
    pool = []
    if spec.get(f"{field}_groups"):
        pool = expand_airports(spec[f"{field}_groups"], spec.get(f"{field}_manual"))
    elif spec.get(field):
        v = spec[field]
        pool = [v] if isinstance(v, str) else list(v)

    pair = spec.get(f"{field}_pair_group")
    if pair:
        ref = chosen[pair["segment"]][pair.get("field", "from")]
        _, codes = _group_of(ref, pair.get("groups"))
        pool = [c for c in (pool or codes) if c in codes] or list(codes)

    mirror = spec.get(f"{field}_mirror")
    if mirror:
        pool = [chosen[mirror["segment"]][mirror.get("field", "from")]]

    excl = spec.get(f"{field}_exclude")
    if excl:
        ref = chosen[excl["segment"]][excl.get("field", "to")]
        pool = [c for c in pool if c != ref]

    return pool


def _resolve_dates(spec, chosen, name, idx):
    """Date options for one segment.

      dates         explicit list, e.g. ["2026-12-23", "2026-12-31"]
      date_range    {"start": ..., "end": ...}, inclusive
      stay_after    {"segment": n, "min": 10, "max": 15, "until": "..."} —
                    depart n's date plus min..max days, clipped at `until`.
                    This is how "紐西蘭待滿十天以上" is expressed.
    """
    stay = spec.get("stay_after")
    if stay:
        base = datetime.strptime(chosen[stay["segment"]]["date"], "%Y-%m-%d")
        lo = int(stay.get("min", 1))
        hi = int(stay.get("max", lo))
        until = datetime.strptime(stay["until"], "%Y-%m-%d") if stay.get("until") else None
        out = []
        for n in range(lo, hi + 1):
            d = base + timedelta(days=n)
            if until and d > until:
                break
            out.append(d.strftime("%Y-%m-%d"))
        return out
    if spec.get("dates"):
        return list(spec["dates"])
    dr = spec.get("date_range") or {}
    if dr.get("start") and dr.get("end"):
        return list(daterange(dr["start"], dr["end"]))
    raise ValueError(f"target {name!r} segment {idx} needs dates / date_range / stay_after")


def expand_target(target, max_tasks=None, allow=None):
    """Expand one target into scrape tasks.

    Segments are resolved left to right rather than as one flat cartesian
    product, because later segments may depend on earlier choices (stay_after,
    *_pair_group, *_exclude).
    """
    name = target.get("name", "(unnamed)")
    specs = target.get("segments", [])
    if not specs:
        raise ValueError(f"target {name!r} has no segments")

    cabins = ["economy"]
    if target.get("include_business"):
        cabins.append("business")

    tasks = []

    def walk(idx, chosen):
        if max_tasks and len(tasks) > max_tasks:
            raise TooManyTasks(name, len(tasks), max_tasks)
        if idx == len(specs):
            for cabin in cabins:
                tasks.append({
                    "target_name": name,
                    "out1": chosen[0]["from"],
                    "out4": chosen[-1]["to"],
                    "cabin": cabin,
                    "segments": [dict(c) for c in chosen],
                })
            return
        spec = specs[idx]
        froms = _resolve_pool(spec, "from", chosen)
        tos = _resolve_pool(spec, "to", chosen)
        if not froms or not tos:
            raise ValueError(f"target {name!r} segment {idx} missing from/to")
        dates = _resolve_dates(spec, chosen, name, idx)
        allow_from = (allow or {}).get((idx, "from"))
        allow_to = (allow or {}).get((idx, "to"))
        for f, t, d in product(froms, tos, dates):
            if f == t:
                continue  # skip nonsensical same-airport segments
            # Prefilter verdicts are applied here rather than after expansion:
            # dropping a dead city before it multiplies out is the whole point.
            if allow_from is not None and (f, d) not in allow_from:
                continue
            if allow_to is not None and (t, d) not in allow_to:
                continue
            chosen.append({"from": f, "to": t, "date": d})
            walk(idx + 1, chosen)
            chosen.pop()

    walk(0, [])
    if not tasks:
        raise ValueError(f"target {name!r} expanded to 0 tasks")
    return tasks


def cheapest_in_budget(rows, budget):
    """For each (source, cabin) bucket, find cheapest in-budget {airline, price, url, segments}.

    Raw row schema: {source, cabin, prices: [{airline, price}, ...], url, segments, ok}
    """
    out = {}
    for r in rows:
        if r.get("error") or not r.get("ok"):
            continue
        prices = r.get("prices") or []
        if not prices:
            continue
        cabin = r.get("cabin", "economy")
        source = r.get("source", "eztravel")
        cap = budget.get(cabin)
        for p in prices:
            price = p.get("price")
            if price is None:
                continue
            if cap is not None and price > cap:
                continue
            key = (source, cabin)
            prev = out.get(key)
            if prev is None or price < prev["price"]:
                out[key] = {
                    "price": price,
                    "airline": p.get("airline"),
                    "url": r.get("url"),
                    "segments": r.get("segments"),
                }
    return out


def maybe_telegram(env, msg):
    token = env.get("TELEGRAM_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = env.get("TELEGRAM_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    import urllib.parse
    import urllib.request
    body = urllib.parse.urlencode({
        "chat_id": chat,
        "text": msg[:4000],
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        urllib.request.urlopen(req, timeout=10).read()
        return True
    except Exception as e:
        print(f"  telegram failed: {e}", file=sys.stderr)
        return False



def probe_cities(args, env, targets):
    """Probe every (outer city, date) for direct service before any expansion.

    Returns {(segment_index, field): {(airport, date), ...}} of survivors, for
    expand_target's `allow`. Probing first is what makes this tractable: with 30
    Japanese airports the un-pruned expansion is over 3 million tasks, so there
    is no point discovering dead cities after building that list.
    """
    probes = set()
    for t in targets:
        specs = t["segments"]
        for city in _resolve_pool(specs[0], "from", []):
            for d in _resolve_dates(specs[0], [], t.get("name", "?"), 0):
                probes.add((city, d, "to-tpe"))
        last = len(specs) - 1
        # The last segment usually names its airports indirectly (mirror the
        # outbound city, or stay inside its country group), and neither can be
        # resolved before anything is chosen — so probe the pool those keys
        # ultimately draw from.
        pair = specs[last].get("to_pair_group") or {}
        mirror = specs[last].get("to_mirror") or {}
        if pair.get("groups"):
            pool = expand_airports(pair["groups"])
        elif mirror:
            pool = _resolve_pool(specs[mirror["segment"]], mirror.get("field", "from"), [])
        else:
            pool = _resolve_pool(specs[last], "to", [])
        for city in pool:
            for d in _resolve_dates(specs[last], [], t.get("name", "?"), last):
                probes.add((city, d, "from-tpe"))
    probes = sorted(probes)

    probe_path = "/tmp/flight-prefilter-probes.jsonl"
    keep_path = "/tmp/flight-prefilter-kept.jsonl"
    with open(probe_path, "w") as f:
        for city, date_, direction in probes:
            f.write(json.dumps({"city": city, "date": date_, "direction": direction}) + "\n")
    reuse = args.prefilter_reuse and os.path.exists(keep_path) and os.path.getsize(keep_path) > 0
    if not reuse:
        open(keep_path, "w").close()

    print(f"\n🔎 prefilter: {len(probes)} 次直飛探測" + ("（沿用上次結果）" if reuse else ""))
    maybe_telegram(env, f"🔎 <b>前置篩選</b>\n{len(probes)} 個「城市×日期」探測直飛航班中…")

    cmd = [NODE, str(ROOT / "scripts" / "prefilter-origins.mjs"),
           "--input", probe_path, "--output", keep_path,
           "--concurrency", str(max(1, min(3, args.concurrency))),
           "--carriers", args.prefilter_carriers]
    if not reuse and subprocess.call(cmd) != 0:
        print("⚠️  prefilter failed — 不篩選，全部照跑", file=sys.stderr)
        return None

    to_tpe, from_tpe, dropped = set(), set(), set()
    with open(keep_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if not r.get("keep", True):
                dropped.add(r["city"])
                continue
            (to_tpe if r["direction"] == "to-tpe" else from_tpe).add((r["city"], r["date"]))

    kept_cities = {c for c, _ in to_tpe} | {c for c, _ in from_tpe}
    print(f"   有直飛: {', '.join(sorted(kept_cities)) or '(無)'}")
    print(f"   剔除:   {', '.join(sorted(dropped - kept_cities)) or '(無)'}")
    maybe_telegram(env, "\n".join([
        "🔎 <b>前置篩選完成</b>",
        f"有直飛: {', '.join(sorted(kept_cities)) or '(無)'}",
        f"剔除: {', '.join(sorted(dropped - kept_cities)) or '(無)'}",
    ]))
    last_idx = max(len(t["segments"]) - 1 for t in targets)
    return {(0, "from"): to_tpe, (last_idx, "to"): from_tpe}


def watch_scrape(cmd, args, env, total, caps, started):
    """Run the scraper, streaming progress and in-budget hits to Telegram.

    The scraper appends one JSONL line per source as it goes, so tailing that
    file gives live progress without touching the scraper itself.
    """
    proc = subprocess.Popen(cmd)
    seen_bytes = 0
    lines_done = 0
    announced = set()
    last_progress = time.time()
    best = {}

    def drain():
        nonlocal seen_bytes, lines_done
        try:
            with open(args.raw_results_path) as f:
                f.seek(seen_bytes)
                chunk = f.read()
                seen_bytes = f.tell()
        except FileNotFoundError:
            return
        for line in chunk.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            lines_done += 1
            prices = r.get("prices") or []
            if not prices:
                continue
            cabin = r.get("cabin", "economy")
            cap = caps.get(cabin)
            cheapest = min(p["price"] for p in prices)
            if cap and cheapest > cap:
                continue
            segs = r.get("segments") or []
            key = (r.get("out1"), r.get("out4"), cabin)
            if best.get(key, 10 ** 9) <= cheapest:
                continue
            best[key] = cheapest
            sig = (key, cheapest)
            if sig in announced:
                continue
            announced.add(sig)
            route = " → ".join(f"{s['from']}/{s['date'][5:]}" for s in segs)
            maybe_telegram(env, "\n".join([
                f"🎯 <b>找到 ${cheapest:,}</b>（{'經濟' if cabin == 'economy' else '商務'}艙，預算 ${cap:,}）",
                f"{r.get('out1')} 出發 · {r.get('out4')} 回",
                route,
                f'<a href="{r.get("url", "")}">訂票連結</a>',
            ]))
            print(f"🎯 HIT {cheapest:,} {r.get('out1')}→{r.get('out4')} {cabin}")

    while proc.poll() is None:
        time.sleep(2)
        drain()
        if args.progress_every and time.time() - last_progress >= args.progress_every:
            last_progress = time.time()
            elapsed = time.time() - started
            rate = lines_done / elapsed if elapsed else 0
            remain = (total * 1 - lines_done) / rate if rate > 0 else 0
            maybe_telegram(env, "\n".join([
                f"⏳ <b>掃描中</b> {lines_done}/{total}",
                f"已跑 {elapsed / 60:.0f} 分 · 預估還要 {remain / 60:.0f} 分",
                f"目前命中 {len(best)} 組",
            ]))
    drain()
    return proc.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", default=str(ROOT / "data" / "my-targets.json"),
                    help="Path to targets JSON (default: data/my-targets.json)")
    ap.add_argument("--results", default=str(ROOT / "data" / "results.json"),
                    help="Path to results JSON (default: data/results.json)")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--tasks-path", default="/tmp/flight-json-tasks.jsonl")
    ap.add_argument("--raw-results-path", default="/tmp/flight-json-results.jsonl")
    ap.add_argument("--reset", action="store_true",
                    help="Overwrite results.json (default: append run alongside existing)")
    ap.add_argument("--dry-run", action="store_true", help="Build tasks and stop without scraping")
    ap.add_argument("--max-tasks", type=int, default=20000,
                    help="Abort expansion past this many tasks (default 20000; 0 disables)")
    ap.add_argument("--prefilter", action="store_true",
                    help="Drop outer cities with no direct BR/CI/JX service before scraping")
    ap.add_argument("--prefilter-carriers", default="長榮航空,中華航空,星宇航空")
    ap.add_argument("--resume", action="store_true",
                    help="Skip tasks already present in --raw-results-path")
    ap.add_argument("--prefilter-reuse", action="store_true",
                    help="Reuse the previous prefilter verdicts instead of probing again")
    ap.add_argument("--sources", default="both",
                    help="Passed through to local-scrape.mjs (eztravel / trip.com / both)")
    ap.add_argument("--progress-every", type=int, default=180,
                    help="Seconds between Telegram progress updates (0 disables)")
    args = ap.parse_args()

    env = load_env_file(ROOT / ".env.local")

    if not os.path.exists(args.targets):
        print(f"❌ targets file not found: {args.targets}", file=sys.stderr)
        print(f"   tip: copy data/example-targets.json to data/my-targets.json and edit",
              file=sys.stderr)
        sys.exit(2)

    with open(args.targets) as f:
        targets = json.load(f)

    if not isinstance(targets, list) or not targets:
        print("❌ targets JSON must be a non-empty list", file=sys.stderr)
        sys.exit(2)

    print(f"📋 loaded {len(targets)} target(s) from {args.targets}")

    allow = probe_cities(args, env, targets) if args.prefilter else None

    # Expand
    all_tasks = []
    by_target = {}
    for t in targets:
        try:
            tasks = expand_target(t, max_tasks=args.max_tasks or None, allow=allow)
        except Exception as e:
            print(f"❌ {t.get('name', '?')}: {e}", file=sys.stderr)
            sys.exit(2)
        # Stamp this target's budget onto its tasks so the scraper can stop
        # after the first source once a ticket is already over budget.
        budget = t.get("budget") or {}
        for task in tasks:
            if budget.get("economy"):
                task["econ_cap"] = budget["economy"]
            if budget.get("business"):
                task["biz_cap"] = budget["business"]
        by_target[t["name"]] = {"target": t, "tasks": tasks}
        all_tasks.extend(tasks)
        print(f"  • {t['name']}: {len(tasks)} task(s) (cartesian-expanded)")

    if not all_tasks:
        print("❌ nothing to scan after expansion", file=sys.stderr)
        sys.exit(2)

    print(f"\n🔢 total tasks: {len(all_tasks)} (× 2 sources each ≈ {len(all_tasks) * 2} scrapes)")

    # Write tasks.jsonl
    with open(args.tasks_path, "w") as f:
        for t in all_tasks:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print(f"📝 wrote {args.tasks_path}")

    if args.dry_run:
        print("(--dry-run set, stopping before scrape)")
        return

    if not args.resume:
        open(args.raw_results_path, "w").close()

    # Spawn local-scrape.mjs
    scrape_script = ROOT / "scripts" / "local-scrape.mjs"
    cmd = [NODE, str(scrape_script),
           "--input", args.tasks_path,
           "--output", args.raw_results_path,
           "--concurrency", str(args.concurrency),
           "--sources", args.sources]
    if args.resume:
        cmd.append("--resume")
    print(f"\n🛫 running scraper (concurrency={args.concurrency}, sources={args.sources})…")
    print(f"   {' '.join(cmd)}")

    caps = {}
    for bucket in by_target.values():
        b = bucket["target"].get("budget") or {}
        for cabin, cap in b.items():
            caps[cabin] = max(caps.get(cabin, 0), cap)
    maybe_telegram(env, "\n".join([
        "🛫 <b>機票掃描開始</b>",
        f"目標 {len(by_target)} 個 · task {len(all_tasks)} 筆 · concurrency {args.concurrency}",
        f"預算 經濟 ${caps.get('economy', 0):,} / 商務 ${caps.get('business', 0):,}",
    ]))

    started = time.time()
    rc = watch_scrape(cmd, args, env, len(all_tasks), caps, started)
    elapsed = time.time() - started
    if rc == 3:
        # local-scrape stopped itself because eztravel's session block kicked
        # in. Expected on a long run — run-batched.sh waits it out and resumes.
        done = sum(1 for _ in open(args.raw_results_path))
        print(f"⏸️  eztravel 擋住了，這批停在 {done} 筆（{elapsed / 60:.1f} 分鐘）", file=sys.stderr)
        maybe_telegram(env, "\n".join([
            "⏸️ <b>被 eztravel 擋住，暫停</b>",
            f"這批跑了 {elapsed / 60:.0f} 分鐘，累計 {done:,} 筆結果",
            "等冷卻後自動續跑，進度不會丟。",
        ]))
        sys.exit(rc)
    if rc != 0:
        print(f"❌ scraper exit {rc} after {elapsed:.1f}s", file=sys.stderr)
        maybe_telegram(env, f"❌ <b>掃描中斷</b>（exit {rc}，跑了 {elapsed / 60:.1f} 分鐘）")
        sys.exit(rc)
    print(f"✅ scraper done in {elapsed:.1f}s")

    # Parse raw results
    raw = []
    with open(args.raw_results_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    print(f"📥 parsed {len(raw)} raw scrape result(s)")

    # Group by target_name
    grouped = {}
    for r in raw:
        grouped.setdefault(r.get("target_name", "?"), []).append(r)

    # Per-target: find cheapest in-budget per (source, cabin) and assemble hit summary
    run_summary = {
        "scan_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "targets": [],
    }
    telegram_lines = [f"✈️ <b>Flight scan complete</b> ({len(targets)} targets, {len(raw)} scrapes)"]
    for tname, info in by_target.items():
        target = info["target"]
        budget = target.get("budget") or {}
        rows = grouped.get(tname, [])
        hits = cheapest_in_budget(rows, budget)
        entry = {
            "name": tname,
            "budget": budget,
            "task_count": len(info["tasks"]),
            "scrape_count": len(rows),
            "hits": [
                {"source": k[0], "cabin": k[1], **v}
                for k, v in sorted(hits.items())
            ],
        }
        run_summary["targets"].append(entry)
        if hits:
            telegram_lines.append(f"\n🎯 <b>{tname}</b>")
            for k, v in sorted(hits.items()):
                src, cab = k
                telegram_lines.append(
                    f"  {src} {cab}: <b>${v.get('price')}</b> {v.get('airline', '')}"
                )
        else:
            telegram_lines.append(f"\n🎯 <b>{tname}</b>: no in-budget hit")

    # Append or reset results.json
    results_path = Path(args.results)
    results_path.parent.mkdir(parents=True, exist_ok=True)
    if args.reset or not results_path.exists():
        runs = []
    else:
        try:
            with open(results_path) as f:
                runs = json.load(f)
            if not isinstance(runs, list):
                runs = []
        except Exception:
            runs = []
    runs.append(run_summary)
    with open(results_path, "w") as f:
        json.dump(runs, f, ensure_ascii=False, indent=2)
    print(f"\n💾 results saved to {results_path} ({len(runs)} run(s) total)")

    # Telegram (if configured)
    if maybe_telegram(env, "\n".join(telegram_lines)):
        print("📲 Telegram summary sent")
    else:
        print("(telegram skipped — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable)")

    # Print human-readable summary
    print("\n────── 結果摘要 ──────")
    for entry in run_summary["targets"]:
        print(f"\n🎯 {entry['name']}  (scanned {entry['scrape_count']} pages)")
        if entry["hits"]:
            for h in entry["hits"]:
                print(f"   {h['source']:8} {h['cabin']:8} ${h['price']:>7}  {h.get('airline') or ''}")
        else:
            print("   (no in-budget hit)")


if __name__ == "__main__":
    main()
