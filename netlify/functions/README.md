# Netlify Functions

`schedule-job.mjs` 是手動更新入口，轉給 `pipeline/http.mjs`。正式環境請設定 `SCHEDULE_JOB_TOKEN`，請求帶 `x-schedule-token`。

`mapping.mjs` 處理 `/api/mapping/*`。未指定 `SCHEDULE_STORE` 時，函數會用 Netlify Blobs 保存 `mapping/overrides.json` 與 `mapping/workspace.json`，對照確認與人手改名才跨實例仍在。

`netlify.toml` 把 `/api/schedule-jobs` 與 `/api/mapping/*` 轉到這些函數。賽程讀取仍走 `VITE_SCHEDULE_BASE` 指向的物件儲存，不把高頻日檔留在函數磁碟。
