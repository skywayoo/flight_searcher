#!/usr/bin/env python3
"""Retry failed scans single-threaded.

Reads target names from /tmp/failed_targets.txt, looks up Notion IDs,
hits scan endpoint sequentially (concurrency 1) so Vercel doesn't time out.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

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
            v = v.replace("\\n", "").replace("\\r", "")
            env[k] = v
    return env


def telegram_send(env, text):
    try:
        body = json.dumps({"chat_id": env["TELEGRAM_CHAT_ID"], "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/sendMessage",
            data=body, method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:
        pass


def main():
    env = {**os.environ, **load_env()}
    nk = env["NOTION_API_KEY"]
    db = env["NOTION_FLIGHT_TARGETS_DB_ID"]

    with open("/tmp/failed_targets.txt") as f:
        names = [line.strip() for line in f if line.strip()]

    # Prioritize PUS/ICN-anchored
    def priority(n):
        return (
            0 if "PUS-ZQN-TPE430-ICN" == n else
            1 if "ICN-ZQN-TPE430-PUS" == n else
            2 if "ICN-ZQN-TPE430-ICN" == n else
            3 if n.startswith("PUS-") or n.endswith("-PUS") else
            4 if n.startswith("ICN-") or n.endswith("-ICN") else
            5
        )
    names.sort(key=priority)
    print(f"Retrying {len(names)} targets sequentially (priority: PUS/ICN first)")

    # Resolve Notion IDs
    name_to_id = {}
    for n in names:
        body = {
            "page_size": 1,
            "filter": {"property": "Name", "title": {"equals": n}},
        }
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
        try:
            res = json.loads(urllib.request.urlopen(req, timeout=20).read())
            if res["results"]:
                name_to_id[n] = res["results"][0]["id"]
        except Exception as e:
            print(f"  resolve fail: {n}: {e}")
        time.sleep(0.3)

    print(f"Resolved {len(name_to_id)} ids")
    telegram_send(env, f"🔁 Retry 啟動：{len(name_to_id)} 個失敗目標單線程重跑")

    base = env["NEXT_PUBLIC_BASE_URL"]
    hits = []
    completed = 0
    started = time.time()

    for n, tid in name_to_id.items():
        completed += 1
        url = f"{base}/api/targets/{tid}/scan"
        t0 = time.time()
        try:
            req = urllib.request.Request(url, method="POST", headers={"x-cron-trigger": "1"})
            res = json.loads(urllib.request.urlopen(req, timeout=320).read())
            cheapest = res.get("cheapest", 0)
            dur = int(time.time() - t0)
            elapsed = int(time.time() - started)
            tag = f"${cheapest}" if cheapest else "no flights"
            print(f"[{completed}/{len(name_to_id)}] ✅ {n[:40]} {tag} ({dur}s) elapsed={elapsed}s", flush=True)
            if cheapest and 0 < cheapest < 50000:
                hits.append((n, cheapest))
                telegram_send(env, f"💰 經濟艙 ${cheapest:,}\n{n}\nhttps://flight-searcher-tw.vercel.app/targets/{tid}")
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()[:120]
            except Exception:
                pass
            dur = int(time.time() - t0)
            print(f"[{completed}/{len(name_to_id)}] ❌ {n[:40]} http {e.code} ({dur}s) {body[:80]}", flush=True)
        except Exception as e:
            dur = int(time.time() - t0)
            print(f"[{completed}/{len(name_to_id)}] ❌ {n[:40]} {str(e)[:80]} ({dur}s)", flush=True)
        # Brief pause so Vercel cold starts settle
        time.sleep(2)

    total = int(time.time() - started)
    msg = f"🏁 Retry 完成 ({total}s) hits={len(hits)}"
    print(msg)
    telegram_send(env, msg)
    if hits:
        sorted_h = sorted(hits, key=lambda x: x[1])
        msg2 = "💰 Retry hits:\n" + "\n".join(f"  ${p:,} {n}" for n, p in sorted_h)
        telegram_send(env, msg2)


if __name__ == "__main__":
    main()
