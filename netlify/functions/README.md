# Netlify Functions

`schedule-job.mjs` 是手動更新入口，轉給 `pipeline/http.mjs`。正式環境請設定 `SCHEDULE_JOB_TOKEN`，請求帶 `x-schedule-token`。

`netlify.toml` 把 `/api/schedule-jobs` 轉到這個函數。賽程讀取仍走 `VITE_SCHEDULE_BASE` 指向的物件儲存，不把高頻日檔留在函數磁碟。
