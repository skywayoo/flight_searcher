#!/usr/bin/env python3
"""Telegram notification helpers with rate limiting and message templates.

Used by run-local-batch.py and import-results.py for unified TG output.
"""
import json
import os
import sys
import time
import urllib.request

# Telegram rate limit: ~1 message/sec to a single chat.
# Be conservative: 1.1s between messages.
_MIN_INTERVAL = 1.1
_last_send = 0.0


def load_env(root=None):
    """Load .env.local from project root. Returns dict."""
    if root is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {}
    env_path = os.path.join(root, ".env.local")
    if not os.path.exists(env_path):
        print(f"warning: {env_path} not found; Telegram disabled", file=sys.stderr)
        return env
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'").replace("\n", "").replace("\r", "")
            env[k] = v
    return env


def send(env, text, silent=False):
    """Send a Telegram message with rate limiting.

    Returns True on success, False on failure (does not raise).
    """
    global _last_send

    token = env.get("TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False

    # Enforce rate limit
    elapsed = time.time() - _last_send
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)

    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_notification": silent,
    }
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=json.dumps(payload).encode(),
                method="POST",
                headers={"Content-Type": "application/json"},
            ),
            timeout=10,
        ).read()
        _last_send = time.time()
        return True
    except Exception as exc:
        print(f"telegram send failed: {exc}", file=sys.stderr)
        return False


# ============================================================
# Message templates
# ============================================================

def msg_batch_start(total_tasks, econ_cap, biz_cap):
    return (
        f"🟢 開始掃描\n"
        f"總組合: {total_tasks}\n"
        f"預算: 經濟 ${econ_cap:,} / 商務 ${biz_cap:,}"
    )


def msg_progress(done, total, elapsed_sec, hits_so_far):
    pct = round(done / max(total, 1) * 100)
    eta = int(elapsed_sec / max(done, 1) * (total - done))
    return (
        f"📊 進度 {pct}% ({done}/{total})\n"
        f"已找到 {hits_so_far} 筆符合預算\n"
        f"耗時 {elapsed_sec // 60}min / 預估剩 {eta // 60}min"
    )


def msg_hit(out1, out4, nz_label, seg4_airport, seg4_date, cabin, price, url, segs):
    tag = "💰 經濟艙" if cabin == "economy" else "✈️ 商務艙"
    return (
        f"{tag} ${price:,}\n"
        f"{out1}-{nz_label}-{seg4_airport}-{out4}\n"
        f"{segs[0]['date']} / {segs[1]['date']} / {segs[2]['date']} / {seg4_date}\n"
        f"{url}"
    )


def msg_batch_done(total, hits, lowest, elapsed_sec, synced_to_notion=None):
    lines = [
        "✅ 掃描完成",
        f"總組合: {total}",
        f"符合預算: {hits} 筆",
    ]
    if lowest is not None:
        lines.append(f"最低價: ${lowest:,}")
    if synced_to_notion is not None:
        lines.append(f"已同步 Notion: {synced_to_notion} 筆")
    lines.append(f"總耗時: {elapsed_sec // 60}min {elapsed_sec % 60}sec")
    return "\n".join(lines)


if __name__ == "__main__":
    # 簡單測試:python notify.py "test message"
    env = load_env()
    text = sys.argv[1] if len(sys.argv) > 1 else "🧪 notify.py self-test"
    ok = send(env, text)
    print("sent" if ok else "failed")
