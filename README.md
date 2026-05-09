# Flight Searcher

易遊網機票監控與比價工具，包含 Next.js 介面、SQLite 掃描資料庫，以及本機批次掃描腳本。

## Features
- 設定監控目標（來回 / 單程 / 外站四段）
- 區域搜尋（東北亞 / 東南亞 / 歐洲...）自動掃所有機場
- 批次掃描完成後產出最低價總表
- 新低價與總表都可透過 Telegram 推播
- 歷史價格紀錄

## Tech Stack
- Next.js 16 (App Router)
- TypeScript + Tailwind CSS v4
- SQLite（本機掃描結果）
- Playwright（爬蟲）
- Vercel（部署 + Cron）
- Telegram Bot（通知）

## Telegram Env
以下環境變數放在 `.env.local`：
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `ECON_BUDGET_CAP` 或 `ECON_CAP`
- `BUSINESS_BUDGET_CAP` 或 `BIZ_CAP`

## Local Batch Scan
執行：

```bash
python3 scripts/run-local-batch.py
```

流程：
- `scripts/build-tasks.py` 產生待掃任務
- `scripts/local-scrape.mjs` 逐批抓價
- `scripts/import-results.py` 匯入 SQLite，並對「低於 budget cap 且刷新歷史最低價」的結果發即時 Telegram
- `scripts/send-price-report.mjs` 在整批完成後發送總結報告

可選參數：
- `--concurrency 4`
- `--batch-size 150`
- `--skip-report`：只匯入結果，不發最後總表

## Notification Behavior
- 即時通知只會在某組合出現新的更低價格時發送，不會對每一筆結果都通知。
- 如果 Telegram token/chat id 缺失，或 Telegram API 發送失敗，`import-results.py` 會輸出錯誤到 stderr。
- 完整掃描結束後的總表通知由 `scripts/send-price-report.mjs` 負責。

## Cron
目前部署環境可透過 cron 掃描 active 目標；本機批次掃描則使用上面的腳本流程。
