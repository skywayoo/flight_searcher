#!/usr/bin/env python3
"""Mass-scan runner: trigger scans on active Notion targets with controlled concurrency.

Reads .env.local for NOTION_API_KEY, CRON_SECRET, NEXT_PUBLIC_BASE_URL,
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.

Concurrency 3 (Vercel scale-out + Notion safety).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    env = {}
    p = os.path.join(ROOT, ".env.local")
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            # Strip literal \n / \r escape sequences that vercel env pull adds
            v = v.replace("\\n", "").replace("\\r", "")
            env[k] = v
    return env


def notion_query_all(nk, db, status_filter):
    out = []
    cursor = None
    while True:
        body = {"page_size": 100}
        if status_filter:
            body["filter"] = {"property": "Status", "select": {"equals": status_filter}}
        if cursor:
            body["start_cursor"] = cursor
        for attempt in range(5):
            try:
                req = urllib.request.Request(
                    f"https://api.notion.com/v1/databases/{db}/query",
                    data=json.dumps(body).encode(),
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {nk}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                )
                res = json.loads(urllib.request.urlopen(req, timeout=20).read())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(5 + attempt * 5)
                    continue
                raise
        for p in res["results"]:
            name = (p["properties"].get("Name", {}).get("title", [{}]) or [{}])[0].get(
                "plain_text", "?"
            )
            out.append((p["id"], name))
        if not res.get("has_more"):
            break
        cursor = res.get("next_cursor")
        time.sleep(0.4)
    return out


def telegram_send(env, text):
    try:
        token = env["TELEGRAM_BOT_TOKEN"]
        chat = env["TELEGRAM_CHAT_ID"]
        body = json.dumps({"chat_id": chat, "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"  tg fail: {e}", flush=True)


def scan_one(env, tid, name):
    base = env["NEXT_PUBLIC_BASE_URL"]
    url = f"{base}/api/targets/{tid}/scan"
    t0 = time.time()
    try:
        req = urllib.request.Request(
            url,
            method="POST",
            headers={"x-cron-trigger": "1"},
        )
        # 5min timeout (matches Vercel maxDuration 300s)
        res = json.loads(urllib.request.urlopen(req, timeout=320).read())
        dur = int(time.time() - t0)
        cheapest = res.get("cheapest", 0)
        return {"id": tid, "name": name, "ok": True, "cheapest": cheapest, "dur": dur, "raw": res}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:200]
        except Exception:
            pass
        return {"id": tid, "name": name, "ok": False, "err": f"http {e.code}: {body}", "dur": int(time.time() - t0)}
    except Exception as e:
        return {"id": tid, "name": name, "ok": False, "err": str(e)[:200], "dur": int(time.time() - t0)}


def main():
    env = {**os.environ, **load_env()}
    nk = env["NOTION_API_KEY"]
    db = env["NOTION_FLIGHT_TARGETS_DB_ID"]

    print("Fetching active targets...", flush=True)
    actives = notion_query_all(nk, db, "active")
    print(f"  {len(actives)} active targets", flush=True)

    telegram_send(env, f"🚀 Mass scan 開始：{len(actives)} 個 active 目標")

    concurrency = int(env.get("MASS_SCAN_CONCURRENCY", "3"))
    print(f"Concurrency: {concurrency}", flush=True)

    hits_econ = []   # <50000
    hits_biz = []    # <80000 business
    failures = 0
    completed = 0
    started = time.time()

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(scan_one, env, tid, name): (tid, name) for tid, name in actives}
        for fut in as_completed(futs):
            r = fut.result()
            completed += 1
            elapsed = int(time.time() - started)
            eta = int((elapsed / completed) * (len(actives) - completed)) if completed > 0 else 0
            mark = "✅" if r["ok"] else "❌"
            cheapest = r.get("cheapest", 0)
            tag = f"${cheapest}" if cheapest else "no flights"
            print(
                f"[{completed}/{len(actives)}] {mark} {r['name'][:40]} {tag} ({r['dur']}s) "
                f"elapsed={elapsed}s eta={eta}s",
                flush=True,
            )
            if not r["ok"]:
                failures += 1
                if failures <= 5:
                    print(f"     err: {r.get('err','?')[:120]}", flush=True)
                continue
            if cheapest and 0 < cheapest < 50000:
                hits_econ.append((r["name"], cheapest))
                # immediate telegram
                telegram_send(env, f"💰 經濟艙 ${cheapest:,}\n{r['name']}\nhttps://flight-searcher-tw.vercel.app/targets/{r['id']}")
            # business hits checked via raw response (top5 not in response, only cheapest econ).
            # Skip biz for now — handled by /api/targets/[id]/scan internal logic.

    total = int(time.time() - started)
    msg = (
        f"🏁 Mass scan 完成 {completed}/{len(actives)} ({total}s)\n"
        f"failures: {failures}\n"
        f"<$50k hits: {len(hits_econ)}"
    )
    print(msg, flush=True)
    telegram_send(env, msg)
    if hits_econ:
        sorted_hits = sorted(hits_econ, key=lambda x: x[1])
        msg2 = "💰 Top hits:\n" + "\n".join([f"  ${p:,} {n}" for n, p in sorted_hits[:15]])
        telegram_send(env, msg2)


if __name__ == "__main__":
    main()
