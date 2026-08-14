from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook


FIELDS = [
    "核心人员", "核心人员背景", "核心人员公开联系方式", "主要产品", "核心技术及应用场景",
    "产业化进展及客户线索", "科创资质及科技项目", "知识产权及技术成果", "上下游",
    "竞争对手", "融资及投资机构背景",
]
NAME_HEADERS = ["企业名称", "企业/项目名称", "项目名称", "公司名称"]
NOTE_HEADERS = ["大赛现场自由笔记", "现场笔记", "现场自由笔记", "现场记录", "自由笔记"]


def text(value: object) -> str:
    return str(value or "").strip()


def load_rows(path: Path) -> list[dict[str, str]]:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [{text(k): text(v) for k, v in row.items()} for row in csv.DictReader(handle)]
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    values = list(sheet.iter_rows(values_only=True))
    if not values:
        return []
    headers = [text(value) for value in values[0]]
    return [{headers[index]: text(value) for index, value in enumerate(row) if index < len(headers)} for row in values[1:]]


def pick_header(headers: set[str], candidates: list[str]) -> str:
    for candidate in candidates:
        if candidate in headers:
            return candidate
    return ""


def safe_name(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*]+', "-", value).strip(" .-")
    return value[:70] or "batch"


def match_key(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def empty_audit() -> dict:
    round_ids = [
        "R1_subject_mapping", "R2_channel_coverage", "R3_field_deepening",
        "R4_anchor_expansion", "R5_gap_and_conflict", "R6_cross_column_and_output",
    ]
    channels = [
        "official_website_or_account", "government_or_park_attachments", "business_profile",
        "visual_search_cards", "patent_standard_ip", "customer_partner_reverse",
        "financing_investor_primary",
    ]
    return {
        "mode": "full_deep_research",
        "onsite_notes_ingested": False,
        "onsite_notes_decomposed": False,
        "onsite_notes_public_crosschecked": False,
        "rounds": {key: {"status": "pending", "queries_or_paths": [], "new_fact_ids": [], "new_anchors": [], "remaining_tasks": []} for key in round_ids},
        "anchor_queue": [], "weak_source_upgrade_queue": [], "conflict_queue": [],
        "coverage_scan_completed": False, "blank_field_followup_completed": False,
        "company_official_channels_checked": False, "government_attachment_lists_checked": False,
        "business_profile_checked": False, "visual_search_cards_checked": False,
        "industrialization_qualification_ip_deepened": False, "cross_column_scan_completed": False,
        "contact_cleanup_completed": False, "investor_background_deepened": False,
        "channel_checks": {key: {"status": "", "paths": [], "notes": ""} for key in channels},
        "field_checks": {}, "person_anchors_found": [], "person_anchors_reviewed": [],
        "confirmed_investors": [], "investor_background_completed_for": [],
    }


def new_record(name: str, note: str, input_path: Path, row_number: int, link_status: str) -> dict:
    enterprise_id = hashlib.sha256(name.encode("utf-8")).hexdigest()[:16]
    source_id = "S-ONSITE-001"
    sources = []
    materials = []
    if note:
        sources.append({
            "source_id": source_id, "source_type": "大赛现场", "title": f"{name}大赛现场自由笔记",
            "location": str(input_path), "retrieved_at": datetime.now().isoformat(timespec="seconds"),
            "supports": "现场记录的团队、产品、客户、经营、融资、里程碑及评委意见", "cannot_support": "",
        })
        materials.append({
            "material_id": "M-ONSITE-001", "material_type": "大赛现场自由笔记", "source_id": source_id,
            "linked_enterprise_name": name, "link_status": link_status, "input_row": row_number,
            "raw_text": note, "processing_status": "pending_extraction", "extracted_fact_ids": [],
        })
    return {
        "enterprise_id": enterprise_id, "enterprise_name": name, "input_name": name,
        "status": "pending_research",
        "subject_mapping": {"status": "ambiguous", "legal_entity": "", "project_name": "", "brand_names": [], "former_names": [], "mapping_basis": ""},
        "coverage": "C", "researched_at": "", "initial_materials": materials, "sources": sources, "facts": [],
        "field_outputs": {field: {"text": "", "basis_fact_ids": []} for field in FIELDS},
        "legacy_inheritance": {"required": False, "completed": True, "candidate_files": [], "matched_sources": [], "reverified_fact_ids": [], "regression_report": "", "unresolved_losses": []},
        "research_audit": empty_audit(),
        "assessment": {"rating": "D", "track": "", "development_stage": "", "stage_benchmark": "", "summary": "", "basis_fact_ids": [], "conclusion_chains": [], "uncertainties": [], "visit_priorities": []},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--notes", help="可选：与企业名单分开上传的现场笔记Excel或CSV")
    parser.add_argument("--name", required=True)
    parser.add_argument("--output-root", default="runs")
    parser.add_argument("--require-onsite-notes", action="store_true")
    args = parser.parse_args()
    input_path = Path(args.input).resolve()
    rows = load_rows(input_path)
    headers = set(rows[0]) if rows else set()
    name_header = pick_header(headers, NAME_HEADERS)
    note_header = pick_header(headers, NOTE_HEADERS)
    if not name_header:
        raise SystemExit(f"Missing enterprise/project name column. Accepted: {NAME_HEADERS}")
    merged: dict[str, list[str]] = {}
    first_row: dict[str, int] = {}
    note_source: dict[str, tuple[Path, int]] = {}
    names_by_key: dict[str, str] = {}
    for index, row in enumerate(rows, start=2):
        name = text(row.get(name_header))
        if not name:
            continue
        key = match_key(name)
        if key in names_by_key and names_by_key[key] != name:
            raise SystemExit(f"企业名单存在规范化后重名，无法安全匹配：{names_by_key[key]} / {name}")
        names_by_key[key] = name
        merged.setdefault(name, [])
        note = text(row.get(note_header)) if note_header else ""
        if note:
            merged[name].append(note)
            note_source.setdefault(name, (input_path, index))
        first_row.setdefault(name, index)

    unmatched_note_names: list[str] = []
    notes_path = Path(args.notes).resolve() if args.notes else None
    if notes_path:
        note_rows = load_rows(notes_path)
        note_headers = set(note_rows[0]) if note_rows else set()
        note_name_header = pick_header(note_headers, NAME_HEADERS)
        separate_note_header = pick_header(note_headers, NOTE_HEADERS)
        if not note_name_header:
            raise SystemExit(f"现场笔记文件缺少企业/项目名称列。Accepted: {NAME_HEADERS}")
        if not separate_note_header:
            raise SystemExit(f"现场笔记文件缺少现场笔记列。Accepted: {NOTE_HEADERS}")
        seen_unmatched: set[str] = set()
        for index, row in enumerate(note_rows, start=2):
            note_name = text(row.get(note_name_header))
            note = text(row.get(separate_note_header))
            if not note_name or not note:
                continue
            matched_name = names_by_key.get(match_key(note_name))
            if not matched_name:
                if note_name not in seen_unmatched:
                    unmatched_note_names.append(note_name)
                    seen_unmatched.add(note_name)
                continue
            if note not in merged[matched_name]:
                merged[matched_name].append(note)
            note_source.setdefault(matched_name, (notes_path, index))

    if args.require_onsite_notes and not note_header and not notes_path:
        raise SystemExit(f"未提供现场笔记列或独立现场笔记文件。Accepted note headers: {NOTE_HEADERS}")
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    run_dir = Path(args.output_root).resolve() / f"{stamp}-{safe_name(args.name)}"
    records_dir = run_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=False)
    companies = []
    missing_notes = []
    for name, notes in merged.items():
        note = "\n".join(dict.fromkeys(notes))
        if not note:
            missing_notes.append(name)
        source_path, source_row = note_source.get(name, (notes_path or input_path, first_row[name]))
        record = new_record(name, note, source_path, source_row, "name_bound" if notes_path else "row_bound")
        record_file = f"records/{record['enterprise_id']}.json"
        (run_dir / record_file).write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        companies.append({"enterprise_id": record["enterprise_id"], "enterprise_name": name, "record_file": record_file})
    manifest = {
        "batch_id": run_dir.name, "batch_name": args.name, "created_at": datetime.now().isoformat(timespec="seconds"),
        "input_file": str(input_path), "notes_file": str(notes_path) if notes_path else "",
        "input_binding_mode": "separate_files_by_name" if notes_path else "combined_file_same_row",
        "company_count": len(companies), "missing_onsite_notes": missing_notes,
        "unmatched_note_names": unmatched_note_names,
        "companies": companies,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    latest = Path(args.output_root).resolve() / "latest-run.txt"
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(str(run_dir), encoding="utf-8")
    print(json.dumps({"status": "BATCH_CREATED", "run": str(run_dir), "companies": len(companies), "missing_onsite_notes": missing_notes, "unmatched_note_names": unmatched_note_names}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
