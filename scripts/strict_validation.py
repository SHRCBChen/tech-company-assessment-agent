from __future__ import annotations

from collections import Counter
from typing import Any


REQUIRED_ROUNDS = [
    "R1_subject_mapping",
    "R2_channel_coverage",
    "R3_field_deepening",
    "R4_anchor_expansion",
    "R5_gap_and_conflict",
    "R6_cross_column_and_output",
]
REQUIRED_FLAGS = [
    "coverage_scan_completed",
    "blank_field_followup_completed",
    "company_official_channels_checked",
    "government_attachment_lists_checked",
    "business_profile_checked",
    "visual_search_cards_checked",
    "industrialization_qualification_ip_deepened",
    "cross_column_scan_completed",
    "contact_cleanup_completed",
    "investor_background_deepened",
]
REQUIRED_CHANNELS = [
    "official_website_or_account",
    "government_or_park_attachments",
    "business_profile",
    "visual_search_cards",
    "patent_standard_ip",
    "customer_partner_reverse",
    "financing_investor_primary",
]
EMPTY_PLACEHOLDERS = ("公开无结果", "公开未详列", "暂无公开", "未查询到", "未检索到")


def _text(value: Any) -> str:
    return str(value or "").strip()


def validate_record(record: dict, fields: list[str]) -> list[str]:
    """Strict fallback validator used when the Node delivery path is unavailable."""
    errors: list[str] = []
    if record.get("status") != "researched":
        errors.append("记录状态不是 researched")

    sources = record.get("sources") or []
    source_ids = {_text(item.get("source_id")) for item in sources if _text(item.get("source_id"))}
    facts = record.get("facts") or []
    fact_ids = {_text(item.get("fact_id")) for item in facts if _text(item.get("fact_id"))}
    for fact in facts:
        if _text(fact.get("source_id")) not in source_ids:
            errors.append(f"事实 {_text(fact.get('fact_id'))} 引用了不存在的来源")

    materials = record.get("initial_materials") or []
    for material in materials:
        if material.get("link_status") != "confirmed":
            errors.append(f"现场笔记 {_text(material.get('material_id'))} 尚未确认企业归属")
        if material.get("processing_status") != "extracted":
            errors.append(f"现场笔记 {_text(material.get('material_id'))} 尚未完成原子化拆解")
        extracted = material.get("extracted_fact_ids") or []
        if _text(material.get("raw_text")) and not extracted:
            errors.append(f"现场笔记 {_text(material.get('material_id'))} 未形成事实ID")
        for fact_id in extracted:
            if fact_id not in fact_ids:
                errors.append(f"现场笔记引用了不存在的事实ID：{fact_id}")

    audit = record.get("research_audit") or {}
    if audit.get("mode") != "full_deep_research":
        errors.append("首轮交付必须使用 full_deep_research")
    rounds = audit.get("rounds") or {}
    signatures: list[tuple[str, ...]] = []
    for round_id in REQUIRED_ROUNDS:
        item = rounds.get(round_id)
        if not item or item.get("status") not in {"complete", "not_applicable"}:
            errors.append(f"深检轮次未完成：{round_id}")
            continue
        if item.get("remaining_tasks"):
            errors.append(f"深检轮次仍有遗留任务：{round_id}")
        paths = tuple(sorted({_text(value) for value in item.get("queries_or_paths", []) if _text(value)}))
        if item.get("status") == "complete" and not paths:
            errors.append(f"深检轮次没有检索路径：{round_id}")
        if paths:
            signatures.append(paths)
    repeated = [count for count in Counter(signatures).values() if count >= 3]
    if repeated:
        errors.append("六轮深检复用了同一组检索词，不能视为独立完成")
    for queue in ("anchor_queue", "weak_source_upgrade_queue", "conflict_queue"):
        if audit.get(queue):
            errors.append(f"仍有未完成队列：{queue}")
    for flag in REQUIRED_FLAGS:
        if audit.get(flag) is not True:
            errors.append(f"深检审计未完成：{flag}")

    channel_checks = audit.get("channel_checks") or {}
    for channel in REQUIRED_CHANNELS:
        check = channel_checks.get(channel)
        if not check or check.get("status") not in {"checked", "not_applicable"}:
            errors.append(f"必查渠道未完成：{channel}")
        elif check.get("status") == "checked" and not [p for p in check.get("paths", []) if _text(p)]:
            errors.append(f"必查渠道没有留下路径：{channel}")

    outputs = record.get("field_outputs") or {}
    field_checks = audit.get("field_checks") or {}
    for field in fields:
        output = outputs.get(field) or {}
        value = _text(output.get("text") if isinstance(output, dict) else output)
        basis = output.get("basis_fact_ids", []) if isinstance(output, dict) else []
        check = field_checks.get(field)
        if not check:
            errors.append(f"缺少字段检索审计：{field}")
            continue
        status = check.get("status")
        if status not in {"found", "blank_after_search", "not_applicable"}:
            errors.append(f"字段审计状态无效：{field}")
        if value and any(marker in value for marker in EMPTY_PLACEHOLDERS):
            errors.append(f"Excel字段不能用无结果说明占位，应留空：{field}")
        if status == "found":
            found = check.get("found_fact_ids") or []
            if not value or not basis or not found:
                errors.append(f"字段标记为 found 但没有正文、依据或事实ID：{field}")
            for fact_id in set(basis) | set(found):
                if fact_id not in fact_ids:
                    errors.append(f"字段 {field} 引用了不存在的事实ID：{fact_id}")
        elif status == "blank_after_search":
            paths = {_text(path) for path in check.get("paths_checked", []) if _text(path)}
            if value:
                errors.append(f"字段标记为空但仍有正文：{field}")
            if len(paths) < 2:
                errors.append(f"空白字段至少需要两条不同检索路径：{field}")

    found_people = set(audit.get("person_anchors_found") or [])
    reviewed_people = set(audit.get("person_anchors_reviewed") or [])
    for person in found_people - reviewed_people:
        errors.append(f"人物锚点尚未反查：{person}")
    investors = set(audit.get("confirmed_investors") or [])
    completed = set(audit.get("investor_background_completed_for") or [])
    for investor in investors - completed:
        errors.append(f"投资方尚未逐家补充背景：{investor}")
    finance_text = _text((outputs.get(fields[-1]) or {}).get("text")) if fields else ""
    for investor in investors:
        if finance_text and investor not in finance_text:
            errors.append(f"已确认投资方未进入融资列：{investor}")
    return list(dict.fromkeys(errors))
