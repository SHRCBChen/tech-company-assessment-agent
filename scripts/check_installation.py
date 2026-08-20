from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    strict_text = (root / "scripts" / "strict_validation.py").read_text(encoding="utf-8-sig") if (root / "scripts" / "strict_validation.py").exists() else ""
    schema_text = (root / "schemas" / "research-record.schema.json").read_text(encoding="utf-8-sig") if (root / "schemas" / "research-record.schema.json").exists() else ""
    checks = {
        "strict_validator": (root / "scripts" / "strict_validation.py").exists(),
        "python_builder_uses_strict_validator": "from strict_validation import validate_record" in (root / "scripts" / "build_deliverables.py").read_text(encoding="utf-8-sig"),
        "separate_note_alias_resolver": "def resolve_note_name" in (root / "scripts" / "start_batch.py").read_text(encoding="utf-8-sig"),
        "research_schema": (root / "schemas" / "research-record.schema.json").exists(),
        "channel_source_binding": "checked_with_sources" in strict_text and '"source_ids"' in schema_text,
        "historical_financing_gate": "historical_financing_scan" in strict_text and "historical_financing_scan" in schema_text,
        "relationship_boundary": "relationship_subject" in strict_text and "relationship_subject" in schema_text,
    }
    status = "INSTALLATION_OK" if all(checks.values()) else "OUTDATED_INSTALLATION"
    print(json.dumps({"status": status, "checks": checks}, ensure_ascii=False, indent=2))
    if status != "INSTALLATION_OK":
        raise SystemExit("当前工作目录仍是旧版工具。请更新整个仓库后重试；只重新导入Skill压缩包不足以更新脚本。")


if __name__ == "__main__":
    main()
