# 澳彩中英對照匯入格式

Phase 1 只檢查格式，並可把通過的列放進瀏覽器裡的待確認佇列（`status: pending`、`source: import`）。不會覆寫已存在的 id，也不會寫回 Git。

允許的 `source_id` 只有：

- `macau_lottery`
- `betexplorer`
- `scoresway`
- `aiscore`
- `leisu`

## JSON `mapping_import_v1`

```json
{
  "version": "mapping_import_v1",
  "items": [
    {
      "entity": "competition",
      "sport": "football",
      "competition_id": "fb-demo-import",
      "name_zh": "示範聯賽",
      "name_en": "Demo League",
      "aliases": [
        { "source_id": "macau_lottery", "name_zh": "示範聯", "name_en": "Demo L." },
        { "source_id": "leisu", "name_zh": "示範聯賽" },
        { "source_id": "betexplorer", "name_en": "Demo League" }
      ]
    },
    {
      "entity": "team",
      "sport": "football",
      "team_id": "fb-demo-united",
      "name_zh": "示範聯",
      "name_en": "Demo United",
      "aliases": [
        { "source_id": "macau_lottery", "name_zh": "示範聯", "name_en": "Demo Utd" }
      ]
    }
  ]
}
```

規則：

- `entity` 是 `competition` 或 `team`。
- `sport` 是 `football` 或 `basketball`。
- `name_zh` 與 `name_en` 都必填。
- 賽事 id 欄位叫 `competition_id`，球隊叫 `team_id`。可留空，介面會產生暫時 id。
- 每個別名至少要有 `name_zh` 或 `name_en` 其中一個。

範例檔：`public/samples/mapping-import.sample.json`。

## CSV

標題列必須完全一致：

```text
entity,sport,id,name_zh,name_en,macau_zh,macau_en,leisu_zh,aiscore_zh,betexplorer_en,scoresway_en
```

每一列是一筆賽事或球隊。空白別名會略過。`id` 依 `entity` 寫入 `competition_id` 或 `team_id`。

```csv
entity,sport,id,name_zh,name_en,macau_zh,macau_en,leisu_zh,aiscore_zh,betexplorer_en,scoresway_en
competition,football,fb-demo-import,示範聯賽,Demo League,示範聯,Demo L.,示範聯賽,,Demo League,
team,football,fb-demo-united,示範聯,Demo United,示範聯,Demo Utd,示範聯,示範聯合,Demo United,Demo Utd
```

範例檔：`public/samples/mapping-import.sample.csv`。

對照頁可以貼上其中一種，按「檢查格式」，再「加入待確認」。
