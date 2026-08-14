from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import date, datetime
from pathlib import Path


def normalized(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def main() -> None:
    parser = argparse.ArgumentParser(description="将拜访或企业材料增量写入已有企业事实记录")
    parser.add_argument("--run", required=True, help="已有批次目录")
    parser.add_argument("--update", required=True, help="符合visit-update.schema.json的增量JSON")
    args = parser.parse_args()

    run_dir = Path(args.run).resolve()
    update_path = Path(args.update).resolve()
    manifest_path = run_dir / "manifest.json"
    manifest = load_json(manifest_path)
    update = load_json(update_path)

    enterprise_name = str(update.get("enterprise_name") or "").strip()
    if not enterprise_name:
        raise SystemExit("增量JSON缺少enterprise_name。")

    company = next(
        (
            item
            for item in manifest.get("companies", [])
            if any(
                normalized(name) == normalized(enterprise_name)
                for name in (item.get("enterprise_name"), item.get("input_name"))
            )
        ),
        None,
    )
    if company is None:
        raise SystemExit(f"批次内未找到企业：{enterprise_name}")

    record_path = run_dir / company["record_file"]
    record = load_json(record_path)
    existing_source_ids = {item.get("source_id") for item in record.get("sources", [])}
    existing_fact_ids = {item.get("fact_id") for item in record.get("facts", [])}

    new_sources = list(update.get("sources") or [])
    new_facts = list(update.get("facts") or [])
    for source in new_sources:
        source_id = source.get("source_id")
        if not source_id:
            raise SystemExit("新增来源缺少source_id。")
        if source_id in existing_source_ids:
            raise SystemExit(f"来源ID重复：{source_id}")
        existing_source_ids.add(source_id)

    facts_by_id = {item.get("fact_id"): item for item in record.get("facts", [])}
    for fact in new_facts:
        fact_id = fact.get("fact_id")
        source_id = fact.get("source_id")
        if not fact_id:
            raise SystemExit("新增事实缺少fact_id。")
        if fact_id in existing_fact_ids:
            raise SystemExit(f"事实ID重复：{fact_id}")
        if source_id not in existing_source_ids:
            raise SystemExit(f"新增事实{fact_id}引用了不存在的来源{source_id}")
        replaces = fact.get("replaces_fact_id")
        if replaces:
            replaced = facts_by_id.get(replaces)
            if replaced is None:
                raise SystemExit(f"新增事实{fact_id}拟替代的事实不存在：{replaces}")
            replaced["valid_status"] = "已替代"
        existing_fact_ids.add(fact_id)

    record["sources"] = [*record.get("sources", []), *new_sources]
    record["facts"] = [*record.get("facts", []), *new_facts]
    if update.get("assessment"):
        record["assessment"] = {**record.get("assessment", {}), **update["assessment"]}
    record["status"] = "researched"
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    updates_dir = run_dir / "updates"
    updates_dir.mkdir(parents=True, exist_ok=True)
    copied = updates_dir / f"{update.get('update_date') or date.today().isoformat()}-{update_path.name}"
    shutil.copy2(update_path, copied)

    manifest["current_stage"] = "update_imported_rebuild_required"
    manifest["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "UPDATE_APPLIED",
                "enterprise": record.get("enterprise_name"),
                "added_sources": len(new_sources),
                "added_facts": len(new_facts),
                "next": f'python scripts/build_deliverables.py --run "{run_dir}"',
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

