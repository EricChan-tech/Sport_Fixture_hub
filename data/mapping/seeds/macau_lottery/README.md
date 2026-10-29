# 澳彩中英名稱種子

這是一次性放進 Git 的名稱表，格式 `macau_lottery_name_import_v1`。來源只有 `macau_lottery`。每筆 `status` 為 `confirmed`，`source` 為 `import`。版本字串沒有因簡稱而改；賽事列多了 `short_name_zh`。

| 檔案 | 筆數 |
| --- | ---: |
| `football_teams.json` | 7745 |
| `basketball_teams.json` | 2832 |
| `football_competitions.json` | 350 |
| `basketball_competitions.json` | 162 |

同名 CSV 方便人工抽查。筆數以 `manifest.json` 為準。籃球賽事舊種子是 163 筆，序號有空缺、最大到 179。新工作簿是連續 1–162：刪去舊序號 162「The Super 8」（中文已損壞），其餘賽事依新序號重排，所以多數籃球 `entity_id` 會跟著序號改。足球仍是 350 筆，序號不變。

## 欄位

每筆 JSON：

- `entity_id`：`macau-{sport}-{kind}-{序號}`，序號來自工作簿
- `sport`：`football` 或 `basketball`
- `kind`：`team` 或 `competition`
- `canonical_name_zh` / `canonical_name_en`：澳彩繁體與英文
- `short_name_zh`：只出現在賽事。繁體簡稱，可為空字串。球隊 JSON 與 CSV 不帶這個欄
- `aliases`：`source_id`、`name`、`normalized`。中文與英文各一筆。簡稱非空、且正規化後不同於中文全稱（也不同於已有別名）時再加一筆。`source_id` 固定為 `macau_lottery`
- `meta.serial`：工作簿序號。球隊另有 `meta.continent`（洲份）與 `meta.category`（賽事類別）
- `status`：`confirmed`
- `source`：`import`

`normalized` 會做 NFKC、合併空白，並把拉丁字母折成小寫（`casefold`）。

賽事 CSV 在 `canonical_name_en` 後面多一欄 `short_name_zh`。球隊 CSV 維持原欄位。

足球有兩筆簡稱為空，按工作簿保留、不自行補名：

| 序號 | 中文全稱 |
| ---: | --- |
| 277 | U19亚洲锦标赛 |
| 307 | 西亚冠军杯 |

簡稱與中文全稱相同的列不會多寫一筆別名。

## 重建

工作簿不進 Git。只重寫賽事、不動球隊：

```bash
python3 scripts/build-macau-seeds.py --competitions fb_comp.xlsx bb_comp.xlsx
node scripts/check-macau-seeds.mjs
```

四份工作簿一起重建時，參數順序仍是足球球隊、籃球球隊、足球賽事、籃球賽事。

## 匯入語意

這些列是澳彩名稱的 Git 種子，初始 `status` 為 `confirmed`、`source` 為 `import`。對照頁可分頁查看全表，賽事表有簡稱欄，搜尋會對上簡稱。人手改名（含簡稱）寫入 `.schedule-store/mapping/overrides.json`，並把該筆標成 `source: manual`，不會改這個種子檔，也不用 Git commit。

## 和儲存層的關係

種子留在 Git。運行時的改名與待確認工作區在 `.schedule-store/mapping/`。雲端物件儲存仍用同一鍵名，由 `SCHEDULE_STORE` 切換。日常確認、拒絕、改名不要用 Git commit 當寫入路徑。
