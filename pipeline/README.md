# 賽程管線

日更與手動更新共用 `run-job.mjs`。它把五個來源的公開賽程頁抓下來，對齊後寫進儲存層，並寫下 `manifest.json` 與 `source_health`。單源失敗只把該來源降級為缺格，整次工作仍成功。抓取失敗或頁面沒有場次時，該運動沿用示範賽程。

## 本機

有 Chrome 或 Edge 時，五個來源一起跑：

```bash
node pipeline/run-job.mjs --trigger manual --sources macau_lottery,betexplorer,scoresway,aiscore,leisu --base-date 2026-10-30
```

只跑其餘四個，或只跑一個：

```bash
node pipeline/run-job.mjs --trigger manual --sources betexplorer,scoresway,aiscore,leisu --base-date 2026-10-30
node pipeline/run-job.mjs --trigger manual --sources betexplorer --base-date 2026-10-30
```

然後 `npm run dev`，打開賽程頁，按「更新此日」。開發伺服器讀的是同一個 `.schedule-store/`。手動窗口仍是澳門今天 ±3 日。

| 來源 | 公開頁 | 怎麼拿 |
| --- | --- | --- |
| 澳彩 | `macauslot.com` 足球／籃球賽程，`lang=cn` 是繁體 | 頁面要瀏覽器才畫得出來。`google-chrome`、`chromium` 或 `MACAU_CHROME` |
| BetExplorer | `betexplorer.com/?year=&month=&day=` 足球日期頁；籃球未來用 `/basketball/next/?year=`，已過用 `/basketball/results/?year=` | 跟網站日期鍵走，並帶 `my_timezone=+8`。列表若還有下一頁，再讀網站自己的 `homepage-data.php`。有 `data-ts` 時用絕對時間，再寫成 Asia/Macau |
| Scoresway | `scoresway.com/en_GB/soccer` 與 `/en_GB/basketball` | 先取 HTML。賽程若要等 Opta 元件畫出，才開一般 headless Chrome |
| AiScore | `aiscore.com` 與 `/basketball` | 頁面自帶的 `__NUXT__` 賽程。驗證頁就停，不解驗證 |
| 雷速 | `m.leisu.com/live/saicheng-YYYYMMDD`，籃球是 `/live/lanqiu/saicheng-YYYYMMDD` | 手機賽程頁。整日名單在頁面資料裡，畫面上只先畫出一部分 |

澳彩開賽鐘點按頁面原文，時區視為 Asia/Macau。其餘來源先還原成絕對時間，再寫成 `+08:00`。名稱用該頁顯示的聯賽與主客隊，不翻譯。手動更新只寫 `--base-date` 那天，日更才寫今天 ±3 日。高信心對齊仍寫進 `.schedule-store/mapping/`，不進 Git。

抓不到、沒有 Chrome，或機房 IP 被拒時，該來源的 `source_health` 為 `down` 或 `degraded`，格子改缺，工作本身仍成功。不要在程式裡解驗證腳本或改指紋。Netlify Functions 與 GitHub Actions 預設沒有 Chrome，機房 IP 也常被 Scoresway、AiScore 擋住，這時會降級。

預設 `SCHEDULE_STORE=local`，目錄是 `.schedule-store/`。物件鍵為 `manifest.json` 與 `{sport}/days/{YYYY-MM-DD}.json`。這個目錄已在 `.gitignore`。

開發伺服器會把同一目錄掛到 `/schedule`，並提供 `POST /api/schedule-jobs`。手動窗口是澳門今天的前後 3 日，兩次手動更新至少相隔 5 分鐘。

## 環境變數

伺服器端：`SCHEDULE_STORE`、`SCHEDULE_STORE_DIR`、`SCHEDULE_JOB_TOKEN`、`RUNNER_EGRESS`、`MACAU_CHROME`、`SCHEDULE_CHROME`。

瀏覽器：澳彩讀 `MACAU_CHROME`。其餘需要瀏覽器的來源先讀 `SCHEDULE_CHROME`，沒有再讀 `MACAU_CHROME`，最後才找 `google-chrome`、`chromium` 或 `msedge`。本機只有 Edge 時，把 `MACAU_CHROME` 設成 `msedge.exe` 的完整路徑，五個來源都能用。

Scoresway 與 AiScore 會用一般 headless Chrome 等頁面畫完。連除錯埠的用戶端是依賴 `ws`，Node 20 沒有全域 `WebSocket` 也能跑。裝依賴時 `npm i` 會帶上它，沒有另外的環境變數。

網址覆寫（可空）：`BETEXPLORER_BASE`、`SCOREWAY_BASE`、`AISCORE_BASE`、`LEISU_BASE`、`LEISU_MOBILE_BASE`。

物件儲存預留：`S3_ENDPOINT`、`S3_BUCKET`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`NETLIFY_BLOBS_SITE_ID`、`NETLIFY_AUTH_TOKEN`。未填時不要把 `SCHEDULE_STORE` 改離 `local`。

前端只讀 `VITE_SCHEDULE_BASE`。`VITE_SCHEDULE_JOB_TOKEN` 只供本機對齊伺服器 token，不要放正式密鑰。

## 對照

種子全表由 `GET /api/mapping/catalog` 分頁。賽事列帶 `short_name_zh`（繁體簡稱，可空），目錄搜尋與對照表簡稱欄會讀它。人手改名在 `mapping/overrides.json`，包含澳彩中文、英文、簡稱，以及其他來源欄（BetExplorer、Scoresway、AiScore、雷速）。空白、待確認、人手或匯入的來源名稱可以改；已確認且來源為自動的別名會在目錄標成自動，寫入時拒絕覆蓋。待確認工作區在 `mapping/workspace.json`。確認與拒絕走 `POST /api/mapping/confirm` 與 `/reject`。

## 對齊

`pipeline/align.mjs` 以運動、開賽時間窗和標準化主客隊 id 併列。高信心隊名用 36 小時窗，低信心收緊到 6 小時。時間不同標黃，主客相反標 `sides_swapped`，缺源維持紅缺。門檻以上自動確認，中間帶進待確認。`npm run check:align` 會把樣本日檔寫進暫存儲存。

## 排程與 IP

GitHub Actions 使用 `cron: "0 6 * * *"` 與 `CRON_TZ: Asia/Macau`。若託管環境忽略時區，等效的 UTC 排程是前一日 22:00。`workflow_dispatch` 走同一支程式，並加上手動窗口檢查。

來源若封鎖機房 IP，把 `RUNNER_EGRESS` 從 `github-hosted` 改成 `self-hosted`，或改由常駐 runner／Workers 送出。住宅代理只保留這個設定位，本階段不接代理密鑰，也不做指紋規避。
