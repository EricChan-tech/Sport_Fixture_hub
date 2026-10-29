"""Turn the Macau lottery name workbooks into Git seed JSON and CSV.

The workbooks are not stored in git. Full rebuild, in this order:
football teams, basketball teams, football competitions, basketball competitions.

Competition-only rebuild leaves team seeds untouched:

    python3 scripts/build-macau-seeds.py --competitions fb_comp.xlsx bb_comp.xlsx

Competition rows use column 3 as the Traditional Chinese short name
(short_name_zh). Team rows still use columns 3–4 as continent and category.
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
NOTE = "Git 種子。日常確認與拒絕不經 Git commit，運行時儲存留待物件儲存。賽事列含 short_name_zh（繁體簡稱，可空）。"
FILE_ORDER = (
    "football_teams.json",
    "basketball_teams.json",
    "football_competitions.json",
    "basketball_competitions.json",
)


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


def aliases(name_zh: str, name_en: str, short_name_zh: str = ""):
    items = []
    for name in (name_zh, name_en):
        items.append({"source_id": SOURCE_ID, "name": name, "normalized": normalize(name)})
    short = short_name_zh.strip()
    if not short:
        return items
    normalized = normalize(short)
    # Skip when the short name is already the canonical Chinese name, or when
    # its normalized form is already stored (for example NBA matching the English name).
    if normalized == normalize(name_zh) or any(item["normalized"] == normalized for item in items):
        return items
    items.append({"source_id": SOURCE_ID, "name": short, "normalized": normalized})
    return items


def record(kind: str, sport: str, row, with_meta: bool):
    serial = int(row[0])
    name_zh = cell(row[1])
    name_en = cell(row[2])
    short_name_zh = cell(row[3]) if kind == "competition" and len(row) > 3 else ""
    meta = {"serial": serial}
    if with_meta:
        meta["continent"] = cell(row[3])
        meta["category"] = cell(row[4]) if len(row) > 4 else ""
    item = {
        "entity_id": f"macau-{sport}-{kind}-{serial}",
        "sport": sport,
        "kind": kind,
        "canonical_name_zh": name_zh,
        "canonical_name_en": name_en,
        "aliases": aliases(name_zh, name_en, short_name_zh if kind == "competition" else ""),
        "meta": meta,
        "status": "confirmed",
        "source": "import",
    }
    if kind == "competition":
        item["short_name_zh"] = short_name_zh
        # Keep short_name_zh next to the canonical names in the JSON object.
        ordered = {}
        for key in (
            "entity_id",
            "sport",
            "kind",
            "canonical_name_zh",
            "canonical_name_en",
            "short_name_zh",
            "aliases",
            "meta",
            "status",
            "source",
        ):
            ordered[key] = item[key]
        return ordered
    return item


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
    fieldnames = [
        "entity_id",
        "sport",
        "kind",
        "canonical_name_zh",
        "canonical_name_en",
    ]
    if kind == "competition":
        fieldnames.append("short_name_zh")
    fieldnames.extend(["continent", "category", "status", "source"])
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            meta = item["meta"]
            row = {
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
            if kind == "competition":
                row["short_name_zh"] = item.get("short_name_zh", "")
            writer.writerow(row)
    return {"file": f"{stem}.json", "csv": f"{stem}.csv", "sport": sport, "kind": kind, "count": len(items)}


def write_manifest(files: list[dict], replace_all: bool) -> None:
    manifest_path = OUT / "manifest.json"
    if replace_all or not manifest_path.exists():
        ordered = files
        manifest = {
            "version": VERSION,
            "source_id": SOURCE_ID,
            "status": "confirmed",
            "source": "import",
            "note": NOTE,
            "files": ordered,
        }
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["version"] = VERSION
        manifest["source_id"] = SOURCE_ID
        manifest["status"] = "confirmed"
        manifest["source"] = "import"
        manifest["note"] = NOTE
        by_file = {entry["file"]: entry for entry in manifest.get("files", [])}
        for entry in files:
            by_file[entry["file"]] = entry
        manifest["files"] = [by_file[name] for name in FILE_ORDER if name in by_file]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def competition_items(sport: str, path: Path) -> list[dict]:
    return [record("competition", sport, row, False) for row in rows_after_header(path)]


def main() -> None:
    args = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    if args and args[0] == "--competitions":
        if len(args) != 3:
            raise SystemExit("usage: build-macau-seeds.py --competitions fb_comp.xlsx bb_comp.xlsx")
        fb_comp, bb_comp = Path(args[1]), Path(args[2])
        files = [
            write_pair("football_competitions", "football", "competition", competition_items("football", fb_comp)),
            write_pair("basketball_competitions", "basketball", "competition", competition_items("basketball", bb_comp)),
        ]
        write_manifest(files, replace_all=False)
        print(json.dumps(files, ensure_ascii=False, indent=2))
        return
    if len(args) != 4:
        raise SystemExit(
            "usage: build-macau-seeds.py fb_teams.xlsx bb_teams.xlsx fb_comp.xlsx bb_comp.xlsx\n"
            "       build-macau-seeds.py --competitions fb_comp.xlsx bb_comp.xlsx"
        )
    fb_teams, bb_teams, fb_comp, bb_comp = [Path(arg) for arg in args]
    files = [
        write_pair("football_teams", "football", "team", [record("team", "football", row, True) for row in rows_after_header(fb_teams)]),
        write_pair("basketball_teams", "basketball", "team", [record("team", "basketball", row, True) for row in rows_after_header(bb_teams)]),
        write_pair("football_competitions", "football", "competition", competition_items("football", fb_comp)),
        write_pair("basketball_competitions", "basketball", "competition", competition_items("basketball", bb_comp)),
    ]
    write_manifest(files, replace_all=True)
    print(json.dumps(files, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
