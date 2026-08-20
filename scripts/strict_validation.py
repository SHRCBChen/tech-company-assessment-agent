from __future__ import annotations

from collections import Counter
import re
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
GENERIC_PATH = re.compile(r"^(?:企查查|websearch|企查查[\\/＋+&]websearch|网页检索|公开检索)$", re.I)
QUALIFICATION_ANCHOR = re.compile(r"高新技术企业|科技型中小企业|专精特新|小巨人|企业技术中心|工程技术中心|研发平台|科技项目|科技计划|创新资金|首台套|首批次|首版次|成果转化|资助公示|认定|备案")
IP_DETAIL_ANCHOR = re.compile(r"登记号|申请号|授权号|专利号|代表专利|技术方向|布图设计|频率合成器|锁相环|标准|论文|受让|许可|失效|质押")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _concrete_paths(values: list[Any]) -> set[str]:
    return {text for value in values if (text := _text(value)) and len(text) >= 8 and not GENERIC_PATH.fullmatch(text)}


def validate_record(record: dict, fields: list[str]) -> list[str]:
    """Strict fallback validator used when the Node delivery path is unavailable."""
    errors: list[str] = []
    if record.get("status") != "researched":
        errors.append("记录状态不是 researched")
    mapping_status = (record.get("subject_mapping") or {}).get("status")
    if mapping_status not in {"confirmed", "project_only", "ambiguous", "blocked"}:
        errors.append("主体映射状态无效，必须使用confirmed/project_only/ambiguous/blocked")

    sources = record.get("sources") or []
    source_ids = {_text(item.get("source_id")) for item in sources if _text(item.get("source_id"))}
    facts = record.get("facts") or []
    fact_ids = {_text(item.get("fact_id")) for item in facts if _text(item.get("fact_id"))}
    for fact in facts:
        if not _text(fact.get("target_field")):
            errors.append(f"事实 {_text(fact.get('fact_id'))} 缺少目标字段")
        if _text(fact.get("source_id")) not in source_ids:
            errors.append(f"事实 {_text(fact.get('fact_id'))} 引用了不存在的来源")
    for source in sources:
        if source.get("source_type") not in {"公开信息", "大赛名单", "大赛现场", "分支行拜访", "企业材料"}:
            errors.append(f"来源 {_text(source.get('source_id'))} 的source_type不符合统一枚举")
        if not _text(source.get("supports")):
            errors.append(f"来源 {_text(source.get('source_id'))} 未说明可支持范围")
        if source.get("source_type") == "公开信息" and not _text(source.get("cannot_support")):
            errors.append(f"来源 {_text(source.get('source_id'))} 未说明证据边界")

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
        if not check or check.get("status") not in {"checked_with_sources", "searched_no_public_result", "not_applicable"}:
            errors.append(f"必查渠道未完成：{channel}")
            continue
        paths = _concrete_paths(check.get("paths") or [])
        linked_sources = set(check.get("source_ids") or [])
        if check.get("status") == "checked_with_sources":
            if not paths:
                errors.append(f"必查渠道没有具体查询或页面路径：{channel}")
            if not linked_sources or not linked_sources.issubset(source_ids):
                errors.append(f"必查渠道没有绑定有效来源ID：{channel}")
        elif check.get("status") == "searched_no_public_result" and len(paths) < 2:
            errors.append(f"无结果渠道未完成两条具体路径：{channel}")
        if channel == "official_website_or_account" and check.get("status") == "checked_with_sources":
            official_sources = [item for item in sources if item.get("source_id") in linked_sources and ("官网" in _text(item.get("title")) or "官方" in _text(item.get("title")))]
            if not official_sources:
                errors.append("官网渠道虽标记有结果，但未登记官网/官方账号具体页面来源")

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
        if status not in {"found", "searched_no_public_result", "not_applicable"}:
            errors.append(f"字段审计状态无效：{field}")
        if value and any(marker in value for marker in EMPTY_PLACEHOLDERS):
            errors.append(f"Excel字段不能用无结果说明占位，应留空：{field}")
        if status == "found":
            found = check.get("fact_ids") or []
            if not value or not basis or not found:
                errors.append(f"字段标记为 found 但没有正文、依据或事实ID：{field}")
            for fact_id in set(basis) | set(found):
                if fact_id not in fact_ids:
                    errors.append(f"字段 {field} 引用了不存在的事实ID：{fact_id}")
        elif status == "searched_no_public_result":
            paths = _concrete_paths(check.get("paths") or [])
            if value:
                errors.append(f"字段标记为空但仍有正文：{field}")
            if len(paths) < 2:
                errors.append(f"空白字段至少需要两条不同检索路径：{field}")

    product_text = _text((outputs.get("主要产品") or {}).get("text"))
    technology_text = _text((outputs.get("核心技术及应用场景") or {}).get("text"))
    if product_text and len(product_text) < 60:
        errors.append("主要产品解释过短，应说明产品是什么、解决的问题、产品形态、主要功能和使用对象")
    if technology_text and not re.search(r"技术路线|关键指标|应用场景|行业对标", technology_text):
        errors.append("核心技术及应用场景缺少技术路线、关键指标、应用场景或行业对标结构")
    risk_text = _text((outputs.get("公开风险事项") or {}).get("text"))
    risk_check = field_checks.get("公开风险事项") or {}
    if risk_text not in {"是", "否"}:
        errors.append("公开风险事项只能填写“是”或“否”且不得在未完成企查查核查时留空")
    if risk_text == "是" and risk_check.get("status") != "found":
        errors.append("风险列填“是”但未登记风险事实")
    if risk_text == "否" and risk_check.get("status") != "searched_no_public_result":
        errors.append("风险列填“否”但未登记企查查无结果核查")
    upstream_text = _text((outputs.get("上下游") or {}).get("text"))
    competitor_text = _text((outputs.get("竞争对手") or {}).get("text"))
    if product_text and not upstream_text:
        errors.append("主要产品已确认但上下游仍为空，应完成产业链位置归纳")
    if product_text and not competitor_text:
        errors.append("主要产品已确认但竞争对手仍为空，应给出同类产品或替代方案厂商")
    qualification_text = _text((outputs.get("科创资质及科技项目") or {}).get("text"))
    if qualification_text and not QUALIFICATION_ANCHOR.search(qualification_text):
        errors.append("科创资质列缺少具体资质、科技项目、研发平台或认定状态")
    ip_text = _text((outputs.get("知识产权及技术成果") or {}).get("text"))
    if ip_text and not IP_DETAIL_ANCHOR.search(ip_text):
        errors.append("知识产权列只有数量或泛称，缺少代表名称、编号、状态或技术方向")
    people_text = _text((outputs.get("核心人员") or {}).get("text"))
    background_text = _text((outputs.get("核心人员背景") or {}).get("text"))
    people_names = set(re.findall(r"[\u4e00-\u9fff·]{2,4}(?=[（(:：])", people_text))
    if people_names and background_text and not any(name in background_text for name in people_names):
        errors.append("核心人员背景仍是团队泛称，未与任何已列核心人员逐人对应")
    relation_words = re.compile(r"客户|合作|送样|定点|订单|出货|中标|供应")
    for fact in facts:
        if fact.get("target_field") == "产业化进展及客户线索" and relation_words.search(_text(fact.get("fact_text"))):
            if not _text(fact.get("relationship_subject")) or not _text(fact.get("relationship_type")):
                errors.append(f"产业化关系事实缺少关系主体或类型：{_text(fact.get('fact_id'))}")
            if fact.get("relationship_type") == "related_company_customer" and fact.get("fact_id") in set((outputs.get("产业化进展及客户线索") or {}).get("basis_fact_ids") or []):
                if "关联公司客户" not in _text((outputs.get("产业化进展及客户线索") or {}).get("text")):
                    errors.append(f"关联公司客户被写入目标企业产业化列但未明确边界：{_text(fact.get('fact_id'))}")

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
        item = (audit.get("investor_checks") or {}).get(investor) or {}
        if item.get("relationship_status") != "publicly_confirmed":
            errors.append(f"已确认投资方缺少公开投资关系核验：{investor}")
        relationship_sources = set(item.get("relationship_source_ids") or [])
        background_sources = set(item.get("background_source_ids") or [])
        if not relationship_sources or not relationship_sources.issubset(source_ids):
            errors.append(f"投资方关系来源无效：{investor}")
        if not background_sources or not background_sources.issubset(source_ids):
            errors.append(f"投资方背景来源无效：{investor}")
        if background_sources and not (background_sources - relationship_sources):
            errors.append(f"投资方背景未使用独立于融资事件的机构/政府/母集团来源：{investor}")
        completed_parts = sum(bool(_text(item.get(key))) for key in ("manager_or_parent", "focus_and_stage", "relevant_resources"))
        if not _text(item.get("institution_type")) or completed_parts < 2:
            errors.append(f"投资方背景未达到最低完整度：{investor}")
    history = audit.get("historical_financing_scan") or {}
    if history.get("status") not in {"completed", "searched_no_public_result", "not_applicable"}:
        errors.append("历史融资扫描未完成")
    else:
        history_paths = _concrete_paths(history.get("paths") or [])
        history_sources = set(history.get("source_ids") or [])
        if history.get("status") == "completed" and (len(history_paths) < 2 or not history_sources or not history_sources.issubset(source_ids)):
            errors.append("历史融资扫描缺少两条具体路径或有效来源ID")
        if history.get("status") == "searched_no_public_result" and len(history_paths) < 2:
            errors.append("历史融资无结果时仍须完成两条具体路径")
    return list(dict.fromkeys(errors))
