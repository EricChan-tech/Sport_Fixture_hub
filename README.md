# 賽程匯

跨資訊公司賽程綜合系統。Phase 1 鎖介面與示範賽程；Phase 2 把日更和手動更新接到同一條管線，並把賽程 JSON 寫進儲存層。五個來源都會抓公開賽程頁；單源失敗只降級該來源。

示範賽程在 `public/fixtures/`，只為了讓白名單、排序、紅黃格和待對照可以操作。正式每日賽程 JSON 會放在物件儲存或 CDN，不提交進 Git。生產環境的 GitHub 倉庫名稱日後可能是 `Sport_Fixture_hub`。

## 本地執行

```bash
npm i
npm run dev
```

開發伺服器預設在 [http://127.0.0.1:43123](http://127.0.0.1:43123)。

建置：

```bash
npm run build
```

`npm run build` 會先跑產品規則、澳彩種子與 Phase 2 管線檢查，再做型別檢查與 Vite 打包。重新產生示範 JSON：

```bash
npm run fixtures
```

## Netlify

`netlify.toml` 已指定：

- Build command：`npm run build`
- Publish directory：`dist`
- Node 22
- SPA fallback 到 `index.html`（已存在的 `/fixtures` 檔案仍照靜態檔提供）

環境變數見 `.env.example`。本機預設把賽程與對照寫進 `.schedule-store/`（不進 Git），開發伺服器用 `/schedule` 讀、用 `/api/schedule-jobs` 觸發。正式賽程頁把 `VITE_SCHEDULE_BASE` 指到 CDN。Netlify Functions 的檔案系統不會留到下一個實例，所以函式裡即使 `SCHEDULE_STORE=local` 也會改把同一批鍵（含 `mapping/overrides.json` 與 `mapping/workspace.json`）寫進 Netlify Blobs。`s3` 與 `r2` 仍只預留環境變數。手動入口要設伺服器環境變數 `SCHEDULE_JOB_TOKEN`，瀏覽器不要內嵌正式密鑰。

每日 06:00（`CRON_TZ=Asia/Macau`）與手動更新都執行 `node pipeline/run-job.mjs`。本機要有 Chrome 或 Edge（`MACAU_CHROME` / `SCHEDULE_CHROME`）。先跑管線再按「更新此日」：

```bash
node pipeline/run-job.mjs --trigger manual --sources macau_lottery,betexplorer,scoresway,aiscore,leisu --base-date 2026-10-30
npm run dev
```

若託管 runner 的 IP 被來源封鎖，或函數環境沒有 Chrome，該來源降級，不讓整次工作失敗。把 `RUNNER_EGRESS` 改成 self-hosted，或改走常駐 runner／Workers；住宅代理只留設定位，沒有接上現成密鑰。細節在 `pipeline/README.md`。

## 產品規則

- 來源只有五個：澳彩 `macau_lottery`、`betexplorer`、`scoresway`、`aiscore`、雷速 `leisu`。
- 正式排程預定每天 06:00（Asia/Macau）。GitHub Actions 草稿在 `.github/workflows/daily-schedule.yml`，cron 為 UTC 22:00，另有 `workflow_dispatch`。
- 手動更新只接受今日 ±3 日。介面上的更新鈕是狀態機：閒置、排隊中、更新中、成功、失敗，並記住 `last_success_at`。連點會被冷卻擋住。
- 白名單 `schedule_whitelist_v1` 按運動存在 localStorage。畫面上只出現已勾選的賽事。
- 有澳彩賽程的賽事強制勾選，不能取消。全不選、還原預設、清除本機偏好，都會把這些鎖定項加回來。預設清單在 `src/config/default_whitelist.json`，載入後再與澳彩鎖定取聯集。足總盃與澳職籃不在預設檔裡，但因為樣本裡有澳彩場次，仍然會顯示。
- 排序可按開賽時間，或把同一賽事排在一起。選擇記在 localStorage。
- 顯示名稱先取澳彩中文，否則雷速或 AiScore 中文，最後才用 BetExplorer 或 Scoresway 英文。
- 來源沒有該場時，格子是紅色「缺」。開賽時間不一致時，格子是黃色並標「偏差」。
- 某來源主客與綜合方向相反時，該來源標 `sides_swapped`。賽程表把該場主隊名與客隊名加上紅框，並寫「主客對調」。這不是紅底「缺」。時間不一致的黃格另標 `delta_minutes`。
- 來源失敗只反映在 `source_health`（正常、降級、中斷）。降級時缺格可以是來源問題，不是賽事取消。不做規避網站防護的事。
- 對照含賽事、球隊與待確認佇列。狀態只有 `confirmed` 或 `pending`，來源是 `auto`、`manual` 或 `import`。
- 澳彩中英名稱種子在 `data/mapping/seeds/macau_lottery/`。完整對照表在「對照」頁分頁瀏覽；改名、待確認，以及確認後的來源別名寫入對照儲存的 `mapping/`，不是 Git commit。本機是 `.schedule-store/`，Netlify Functions 是 Blobs。
- 對齊引擎在 `pipeline/align.mjs`。高信心隊名用 36 小時窗併列後標黃，低信心才收緊。主客相反寫 `sides_swapped`。

## 目錄

```text
src/types/schema.ts          賽程、manifest、對照、白名單型別
src/lib/productRules.mjs     白名單聯集、名稱優先序、兩種排序、手動窗口
src/config/                  default_whitelist.json、aliases.json、mapping.seed.json
public/fixtures/             Phase 1 示範賽程（不是正式資料庫）
src/views/SchedulePage.vue   賽程表
src/views/MappingPage.vue    對照與匯入殼
docs/mapping-import.md       日後澳彩中英 CSV／JSON 格式
ingest/                   五個來源的公開賽程頁抓取
netlify/functions/           日後函數
```

Git 留程式與設定。`public/fixtures/` 是這一階段的介面樣本，說明見該目錄的 README。

## Phase 1 驗收

- [x] `npm run build` 可通過
- [x] 足球／籃球可切換；日期預設為澳門今天，可前後日與日曆
- [x] 白名單可搜尋；澳彩賽事鎖定，提示「澳彩賽事固定顯示」；全不選與清除偏好仍保留鎖定項
- [x] 開賽時間與賽事兩種排序，並記住選擇
- [x] 缺格為紅「缺」，時間不一致為黃
- [x] 名稱依澳彩中文 → 雷速／AiScore 中文 → BetExplorer／Scoresway 英文
- [x] 更新鈕有狀態機、上次成功時間，以及冷卻
- [x] 對照頁有待確認數字、確認／拒絕，以及匯入格式說明
- [x] 來源清單只有上述五個
- [x] 每日 06:00（Asia/Macau）的 Actions 草稿可手動觸發

示範日可以從 10 月 30 日看起。那一天同時有澳彩鎖定、可取消的法甲、紅色缺格、黃色偏差（含相差分鐘）、曼聯對利物浦的主客對調紅框，以及曼聯等待對照。若以這一天為澳門今天，手動更新窗口是 10 月 27 日至 11 月 2 日。
