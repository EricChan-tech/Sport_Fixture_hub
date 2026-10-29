"""Turn the Macau lottery name workbooks into Git seed JSON and CSV.

The workbooks are not stored in git. Pass their paths in this order:
football teams, basketball teams, football competitions, basketball competitions.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "mapping" / "seeds" / "macau_lottery"
VERSION = "macau_lottery_name_import_v1"
SOURCE_ID = "macau_lottery"


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFKC", value).strip()
    return re.sub(r"\s+", " ", text).casefold()


def cell(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def rows_after_header(path: Path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    workbook.close()
    header_at = next(index for index, row in enumerate(rows) if cell(row[0]) == "序號")
    for row in rows[header_at + 1 :]:
        if row is None or all(cell(item) == "" for item in row):
            continue
        yield row


def aliases(name_zh: str, name_en: str):
    items = []
    for name in (name_zh, name_en):
        items.append({"source_id": SOURCE_ID, "name": name, "normalized": normalize(name)})
    return items


def record(kind: str, sport: str, row, with_meta: bool):
    serial = int(row[0])
    name_zh = cell(row[1])
    name_en = cell(row[2])
    meta = {"serial": serial}
    if with_meta:
        meta["continent"] = cell(row[3])
        meta["category"] = cell(row[4])
    return {
        "entity_id": f"macau-{sport}-{kind}-{serial}",
        "sport": sport,
        "kind": kind,
        "canonical_name_zh": name_zh,
        "canonical_name_en": name_en,
        "aliases": aliases(name_zh, name_en),
        "meta": meta,
        "status": "confirmed",
        "source": "import",
    }


def write_pair(stem: str, sport: str, kind: str, items: list[dict]):
    payload = {
        "version": VERSION,
        "source_id": SOURCE_ID,
        "sport": sport,
        "kind": kind,
        "count": len(items),
        "items": items,
    }
    json_path = OUT / f"{stem}.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    csv_path = OUT / f"{stem}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "entity_id",
                "sport",
                "kind",
                "canonical_name_zh",
                "canonical_name_en",
                "continent",
                "category",
                "status",
                "source",
            ],
        )
        writer.writeheader()
        for item in items:
            meta = item["meta"]
            writer.writerow(
                {
                    "entity_id": item["entity_id"],
                    "sport": sport,
                    "kind": kind,
                    "canonical_name_zh": item["canonical_name_zh"],
                    "canonical_name_en": item["canonical_name_en"],
                    "continent": meta.get("continent", ""),
                    "category": meta.get("category", ""),
                    "status": item["status"],
                    "source": item["source"],
                }
            )
    return {"file": f"{stem}.json", "csv": f"{stem}.csv", "sport": sport, "kind": kind, "count": len(items)}


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("usage: build-macau-seeds.py fb_teams.xlsx bb_teams.xlsx fb_comp.xlsx bb_comp.xlsx")
    fb_teams, bb_teams, fb_comp, bb_comp = [Path(arg) for arg in sys.argv[1:]]
    OUT.mkdir(parents=True, exist_ok=True)
    files = [
        write_pair("football_teams", "football", "team", [record("team", "football", row, True) for row in rows_after_header(fb_teams)]),
        write_pair("basketball_teams", "basketball", "team", [record("team", "basketball", row, True) for row in rows_after_header(bb_teams)]),
        write_pair("football_competitions", "football", "competition", [record("competition", "football", row, False) for row in rows_after_header(fb_comp)]),
        write_pair("basketball_competitions", "basketball", "competition", [record("competition", "basketball", row, False) for row in rows_after_header(bb_comp)]),
    ]
    manifest = {
        "version": VERSION,
        "source_id": SOURCE_ID,
        "status": "confirmed",
        "source": "import",
        "note": "Git 種子。日常確認與拒絕不經 Git commit，運行時儲存留待物件儲存。",
        "files": files,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(files, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
