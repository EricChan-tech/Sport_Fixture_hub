# 澳彩中英名稱種子

這是一次性放進 Git 的名稱表，格式 `macau_lottery_name_import_v1`。來源只有 `macau_lottery`。每筆 `status` 為 `confirmed`，`source` 為 `import`。

| 檔案 | 筆數 |
| --- | ---: |
| `football_teams.json` | 7745 |
| `basketball_teams.json` | 2832 |
| `football_competitions.json` | 350 |
| `basketball_competitions.json` | 163 |

同名 CSV 方便人工抽查。筆數以 `manifest.json` 為準。

## 欄位

每筆 JSON：

- `entity_id`：`macau-{sport}-{kind}-{序號}`，序號來自原表
- `sport`：`football` 或 `basketball`
- `kind`：`team` 或 `competition`
- `canonical_name_zh` / `canonical_name_en`：澳彩繁體與英文
- `aliases`：`source_id`、`name`、`normalized`。中文與英文各一筆，`source_id` 固定為 `macau_lottery`
- `meta.serial`：原表序號。球隊另有 `meta.continent`（洲份）與 `meta.category`（賽事類別）
- `status`：`confirmed`
- `source`：`import`

`normalized` 會做 NFKC、合併空白，並把拉丁字母折成小寫。

## 匯入語意

這些列是澳彩名稱的 Git 種子，初始 `status` 為 `confirmed`、`source` 為 `import`。對照頁可分頁查看全表。人手改名寫入 `.schedule-store/mapping/overrides.json`，並把該筆標成 `source: manual`，不會改這個種子檔，也不用 Git commit。

## 和儲存層的關係

種子留在 Git。運行時的改名與待確認工作區在 `.schedule-store/mapping/`。雲端物件儲存仍用同一鍵名，由 `SCHEDULE_STORE` 切換。日常確認、拒絕、改名不要用 Git commit 當寫入路徑。
