# 日後的擷取

這個目錄預留給之後的真實頁面抓取。Phase 2 的發佈入口在 `pipeline/run-job.mjs`，尚未從這裡連線任何來源。

預期邊界：

- 來源只有 `macau_lottery`、`betexplorer`、`scoresway`、`aiscore`、`leisu`。
- 每日 06:00（Asia/Macau）跑一輪；手動更新只接受當日 ±3 日。
- 來源失敗寫進 `source_health`，賽程格降級為 `missing`，不繞過網站防護。
- 產出寫到物件儲存的 `manifest.json` 與每日檔，不把高頻賽程提交進 Git。
- 賽事與球隊對照沿用 `mapping_store_v1`。澳彩中英檔之後走 `docs/mapping-import.md` 的格式。
