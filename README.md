# Flight Searcher

易遊網機票監控與比價工具。

## Features
- 設定監控目標（來回 / 單程 / 外站四段）
- 區域搜尋（東北亞 / 東南亞 / 歐洲...）自動掃所有機場
- 每天 cron 自動掃描，價格變動 Telegram 推播
- 歷史價格紀錄

## Tech Stack
- Next.js 16 (App Router)
- TypeScript + Tailwind CSS v4
- Notion API (儲存目標 + 結果)
- Playwright (爬蟲，繞過 Incapsula)
- Vercel (部署 + Cron)
- Telegram Bot (通知)

## Cron
每天 18:00 (UTC) = 02:00 (台灣) 自動掃描所有 active 目標。

## Scraper Status
目前是 stub 模式（產生假資料）。真實爬蟲需要 Playwright + 處理 Incapsula JS challenge，正在開發中。
