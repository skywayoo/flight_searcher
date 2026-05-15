#!/usr/bin/env python3
"""Sequentially scan every active FlightTarget by calling the dev server's
scan endpoint. Reports progress to Telegram. Designed for long unattended
runs (10+ hours).

Usage:
  python3 scripts/scan-all-active.py [--base-url http://localhost:3000]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import notify  # noqa: E402


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'").replace("\\n", "")
    return env


def fetch_active_targets(token, db):
    targets = []
    cursor = None
    while True:
        body = {"page_size": 100, "filter": {"property": "Status", "select": {"equals": "active"}}}
        if cursor:
            body["start_cursor"] = cursor
        req = urllib.request.Request(
            f"https://api.notion.com/v1/databases/{db}/query",
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
            },
            data=json.dumps(body).encode(),
        )
        d = json.loads(urllib.request.urlopen(req, timeout=30).read())
        for p in d["results"]:
            name = ""
            name_prop = p["properties"].get("Name", {})
            if name_prop.get("type") == "title":
                name = "".join(x["plain_text"] for x in name_prop["title"])
            targets.append({"id": p["id"], "name": name})
        if not d.get("has_more"):
            break
        cursor = d.get("next_cursor")
    return targets


def scan_one(base_url, target_id, timeout):
    req = urllib.request.Request(
        f"{base_url}/api/targets/{target_id}/scan",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=b"{}",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "ignore")
            return True, body
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read()[:300].decode('utf-8','ignore')}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--per-scan-timeout", type=int, default=10800,
                    help="Seconds to wait for each /scan call (default 3hr).")
    args = ap.parse_args()

    env = load_env()
    token = env["NOTION_API_KEY"]
    db = env["NOTION_FLIGHT_TARGETS_DB_ID"]

    targets = fetch_active_targets(token, db)
    if not targets:
        print("no active targets, exiting")
        return

    total = len(targets)
    notify.send(env, f"🚀 全掃開始：{total} 個 active target，base={args.base_url}")
    started = time.time()
    success = 0
    fail = 0
    cheapest_overall = None
    cheapest_overall_name = None

    for i, t in enumerate(targets, 1):
        t0 = time.time()
        ok, body = scan_one(args.base_url, t["id"], args.per_scan_timeout)
        dur = int(time.time() - t0)
        cheapest = None
        count = 0
        if ok:
            try:
                data = json.loads(body)
                cheapest = data.get("cheapest")
                count = data.get("count", 0)
            except json.JSONDecodeError:
                pass
        if ok:
            success += 1
            if cheapest and cheapest > 0:
                if cheapest_overall is None or cheapest < cheapest_overall:
                    cheapest_overall = cheapest
                    cheapest_overall_name = t["name"]
                msg = f"[{i}/{total}] ✓ {t['name']}: cheapest TWD {cheapest:,} ({count} 筆, {dur}s)"
            else:
                msg = f"[{i}/{total}] ∅ {t['name']}: 沒有預算內結果 ({dur}s)"
        else:
            fail += 1
            msg = f"[{i}/{total}] ✗ {t['name']}: {body[:120]}"
        print(msg, flush=True)
        # Telegram per-target — silent unless hit
        notify.send(env, msg, silent=(cheapest is None or cheapest == 0))

    elapsed = int(time.time() - started)
    h, m = divmod(elapsed // 60, 60)
    summary = (
        f"🏁 全掃完成 {h}h{m}m / 成功 {success} / 失敗 {fail}"
    )
    if cheapest_overall:
        summary += f"\n最便宜：{cheapest_overall_name} TWD {cheapest_overall:,}"
    notify.send(env, summary)


if __name__ == "__main__":
    main()
