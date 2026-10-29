# 賽程管線

日更與手動更新共用 `run-job.mjs`。它把示範目錄發佈到儲存層，並寫下 `manifest.json` 與 `source_health`。五個來源都還沒有真實頁面抓取；未抓取的來源標成降級，單源失敗不會讓整次工作失敗。

## 本機

```bash
node pipeline/run-job.mjs --trigger manual --base-date 2026-10-30
```

預設 `SCHEDULE_STORE=local`，目錄是 `.schedule-store/`。物件鍵為 `manifest.json` 與 `{sport}/days/{YYYY-MM-DD}.json`。這個目錄已在 `.gitignore`。

開發伺服器會把同一目錄掛到 `/schedule`，並提供 `POST /api/schedule-jobs`。手動窗口是澳門今天的前後 3 日，兩次手動更新至少相隔 5 分鐘。

## 環境變數

伺服器端：`SCHEDULE_STORE`、`SCHEDULE_STORE_DIR`、`SCHEDULE_JOB_TOKEN`、`RUNNER_EGRESS`。

物件儲存預留：`S3_ENDPOINT`、`S3_BUCKET`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`NETLIFY_BLOBS_SITE_ID`、`NETLIFY_AUTH_TOKEN`。未填時不要把 `SCHEDULE_STORE` 改離 `local`。

前端只讀 `VITE_SCHEDULE_BASE`。`VITE_SCHEDULE_JOB_TOKEN` 只供本機對齊伺服器 token，不要放正式密鑰。

## 對照

種子全表由 `GET /api/mapping/catalog` 分頁。賽事列帶 `short_name_zh`（繁體簡稱，可空），目錄搜尋與對照表簡稱欄會讀它。人手改名在 `mapping/overrides.json`。待確認工作區在 `mapping/workspace.json`。確認與拒絕走 `POST /api/mapping/confirm` 與 `/reject`。

## 對齊

`pipeline/align.mjs` 以運動、開賽時間窗和標準化主客隊 id 併列。高信心隊名用 36 小時窗，低信心收緊到 6 小時。時間不同標黃，主客相反標 `sides_swapped`，缺源維持紅缺。門檻以上自動確認，中間帶進待確認。`npm run check:align` 會把樣本日檔寫進暫存儲存。

## 排程與 IP

GitHub Actions 使用 `cron: "0 6 * * *"` 與 `CRON_TZ: Asia/Macau`。若託管環境忽略時區，等效的 UTC 排程是前一日 22:00。`workflow_dispatch` 走同一支程式，並加上手動窗口檢查。

來源若封鎖機房 IP，把 `RUNNER_EGRESS` 從 `github-hosted` 改成 `self-hosted`，或改由常駐 runner／Workers 送出。住宅代理只保留這個設定位，本階段不接代理密鑰，也不做指紋規避。
