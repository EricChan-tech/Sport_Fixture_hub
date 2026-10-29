# 賽程管線

日更與手動更新共用 `run-job.mjs`。它把賽程發佈到儲存層，並寫下 `manifest.json` 與 `source_health`。澳彩會打開公開賽程頁；其餘四個來源仍未抓取，標成降級。單源失敗不會讓整次工作失敗。

## 本機

```bash
node pipeline/run-job.mjs --trigger manual --base-date 2026-10-30
node pipeline/run-job.mjs --trigger manual --sources macau_lottery --base-date 2026-10-30
```

只跑澳彩時，足球讀 `https://www.macauslot.com/cn/soccer/fixture.html?lang=cn`，籃球讀 `https://www.macauslot.com/cn/basketball/fixture.html?lang=cn`。這兩頁的 `lang=cn` 是繁體（zh-HK）。頁面由瀏覽器畫出賽程，純 HTTP 客戶端多半只收到驗證頁。抓取器在找到 `google-chrome`、`chromium` 或 `MACAU_CHROME` 時，用一般 headless Chrome 打開這兩個公開網址，再解析畫面上的日期、時間、聯賽與主客隊。沒有自訂指紋、沒有代理密鑰。兩頁之間相隔 2 秒。

開賽時間按頁面上的鐘點，時區是 Asia/Macau（GMT+8）。賽程頁一次列出多日；手動更新只寫 `--base-date` 那天，日更才寫今天 ±3 日。賽事簡稱會對上 `data/mapping/seeds/macau_lottery/` 的種子；對不上的聯賽用穩定 id，仍然因為 `has_macau` 而鎖定白名單。其餘四源的格子維持缺。

抓不到、沒有 Chrome，或頁面結構對不上時，`source_health.macau_lottery` 為 `down` 或 `degraded`，澳彩格改為缺，工作本身仍成功。賽程頁通常由今天往後列，更早的已完場日期可能是空陣列，不是示範資料。機房 IP 若被驗證頁擋住，把 `RUNNER_EGRESS` 改成 self-hosted；不要在程式裡解驗證腳本。

預設 `SCHEDULE_STORE=local`，目錄是 `.schedule-store/`。物件鍵為 `manifest.json` 與 `{sport}/days/{YYYY-MM-DD}.json`。這個目錄已在 `.gitignore`。

開發伺服器會把同一目錄掛到 `/schedule`，並提供 `POST /api/schedule-jobs`。手動窗口是澳門今天的前後 3 日，兩次手動更新至少相隔 5 分鐘。

## 環境變數

伺服器端：`SCHEDULE_STORE`、`SCHEDULE_STORE_DIR`、`SCHEDULE_JOB_TOKEN`、`RUNNER_EGRESS`、`MACAU_CHROME`。

物件儲存預留：`S3_ENDPOINT`、`S3_BUCKET`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`NETLIFY_BLOBS_SITE_ID`、`NETLIFY_AUTH_TOKEN`。未填時不要把 `SCHEDULE_STORE` 改離 `local`。

前端只讀 `VITE_SCHEDULE_BASE`。`VITE_SCHEDULE_JOB_TOKEN` 只供本機對齊伺服器 token，不要放正式密鑰。

## 對照

種子全表由 `GET /api/mapping/catalog` 分頁。賽事列帶 `short_name_zh`（繁體簡稱，可空），目錄搜尋與對照表簡稱欄會讀它。人手改名在 `mapping/overrides.json`，包含澳彩中文、英文、簡稱，以及其他來源欄（BetExplorer、Scoresway、AiScore、雷速）。空白、待確認、人手或匯入的來源名稱可以改；已確認且來源為自動的別名會在目錄標成自動，寫入時拒絕覆蓋。待確認工作區在 `mapping/workspace.json`。確認與拒絕走 `POST /api/mapping/confirm` 與 `/reject`。

## 對齊

`pipeline/align.mjs` 以運動、開賽時間窗和標準化主客隊 id 併列。高信心隊名用 36 小時窗，低信心收緊到 6 小時。時間不同標黃，主客相反標 `sides_swapped`，缺源維持紅缺。門檻以上自動確認，中間帶進待確認。`npm run check:align` 會把樣本日檔寫進暫存儲存。

## 排程與 IP

GitHub Actions 使用 `cron: "0 6 * * *"` 與 `CRON_TZ: Asia/Macau`。若託管環境忽略時區，等效的 UTC 排程是前一日 22:00。`workflow_dispatch` 走同一支程式，並加上手動窗口檢查。

來源若封鎖機房 IP，把 `RUNNER_EGRESS` 從 `github-hosted` 改成 `self-hosted`，或改由常駐 runner／Workers 送出。住宅代理只保留這個設定位，本階段不接代理密鑰，也不做指紋規避。
