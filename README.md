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
- Vercel（部署 + 手動/API 觸發）
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

## Batch Scan Rules
- `out1` / `out4` 會用 `scripts/scan_config.py` 的 `OUTSTATIONS` 做全組合。
- `NZ_CONFIGS` 目前會掃：`ZQN-ZQN`、`CHC-CHC`、`ZQN-CHC`、`CHC-ZQN`。
- 日期 variation 目前使用 `VARIATIONS[:2]`，也就是前兩組日期偏移。
- 第四段規則：`TPE` 維持原本 variation 對應的第四段日期。
- 第四段規則：`TSA` 會額外掃兩種，第三段回到台灣的當天，以及隔天。
- 因為 `TSA` 有兩個日期候選，資料庫與 skip key 會用 `out1 + out4 + nz + seg4_airport + variation_idx + seg4_date + cabin` 去識別，避免不同第四段候選互相覆蓋。

## Architecture
- `app/`：Vercel/Next.js 介面與 API。現在只負責頁面顯示、手動觸發和單一 target 掃描。
- `app/api/targets/[id]/scan/route.ts`：線上單一 target 掃描入口，抓完後寫結果並視跌幅發 Telegram。
- `app/api/cron/route.ts`：route 還保留，但 Vercel 已停用定時排程，不會再自動每天跑。
- `scripts/run-local-batch.py`：本機批次掃描總控。依序呼叫 build tasks、local scrape、import results、send report。
- `scripts/build-tasks.py`：依掃描規則展開所有本次要跑的 task，並跳過 SQLite 裡已經完成或已標記 skip 的組合。
- `scripts/local-scrape.mjs`：純本機 Playwright 抓價器。只吃 JSONL task，輸出 JSONL result，不碰 Vercel。
- `scripts/import-results.py`：把 JSONL result 寫回 SQLite，處理 over-budget skip，並對新低價發即時 Telegram。
- `scripts/send-price-report.mjs`：從 SQLite 彙整每個 `out1 -> out4` 的最低有效價，發送總表與摘要到 Telegram。
- `scripts/scan_config.py`：本機 batch 共用設定中心，包含外站清單、日期 variation、第四段規則、budget cap。
- `data/flight-results.sqlite`：本機掃描資料庫。
- `scrape_results`：所有抓到的結果，含價格、四段日期、第四段機場、錯誤資訊。
- `skipped_results`：高於 budget cap 而不進主表的結果，仍保留第四段機場與日期，供 resume/skip 使用。

## Notification Behavior
- 即時通知只會在某組合出現新的更低價格時發送，不會對每一筆結果都通知。
- 如果 Telegram token/chat id 缺失，或 Telegram API 發送失敗，`import-results.py` 會輸出錯誤到 stderr。
- 完整掃描結束後的總表通知由 `scripts/send-price-report.mjs` 負責。

## Cron
Vercel 已停用定時 cron，不再每天自動掃描 active 目標。
目前 Vercel 只負責頁面顯示與手動/API 觸發功能；需要批次掃描時，改用本機腳本流程。
