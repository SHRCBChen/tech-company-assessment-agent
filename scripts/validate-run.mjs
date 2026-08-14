import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIELDS = new Set(["核心人员", "核心人员背景", "核心人员公开联系方式", "主要产品", "核心技术及应用场景", "产业化进展及客户线索", "科创资质及科技项目", "知识产权及技术成果", "上下游", "竞争对手", "融资及投资机构背景", "不进入Excel"]);
const PUBLIC_CONTACT_BAD = /(总机|客服|销售|招聘|热线|400[-\s]?\d|公共邮箱|企业邮箱|公司电话|官网电话)/i;
const FIELD_LIST = [...FIELDS].filter((field) => field !== "不进入Excel");
const REQUIRED_AUDIT_FLAGS = [
  "coverage_scan_completed",
  "blank_field_followup_completed",
  "company_official_channels_checked",
  "government_attachment_lists_checked",
  "business_profile_checked",
  "visual_search_cards_checked",
  "industrialization_qualification_ip_deepened",
  "cross_column_scan_completed",
  "contact_cleanup_completed",
  "investor_background_deepened"
];
const REQUIRED_CHANNEL_CHECKS = [
  "official_website_or_account",
  "government_or_park_attachments",
  "business_profile",
  "visual_search_cards",
  "patent_standard_ip",
  "customer_partner_reverse",
  "financing_investor_primary"
];
const REQUIRED_ROUNDS = [
  "R1_subject_mapping",
  "R2_channel_coverage",
  "R3_field_deepening",
  "R4_anchor_expansion",
  "R5_gap_and_conflict",
  "R6_cross_column_and_output"
];
const GENERIC_SOURCE_URL = /^https?:\/\/[^/]+\/?(?:[?#].*)?$/i;

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

function hasNamedContact(text) {
  return /^[\u3400-\u9FFF·A-Za-z]{2,30}[：:]/.test(text);
}

export async function validateRun(runDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8"));
  const review = [];
  for (const company of manifest.companies) {
    const file = path.join(runDir, company.record_file);
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    const errors = [];
    const warnings = [];
    if (!record.enterprise_name) errors.push("缺少企业名称");
    if (!["confirmed", "project_only", "ambiguous", "blocked"].includes(record.subject_mapping?.status)) errors.push("主体映射状态无效");
    if (["ambiguous", "blocked"].includes(record.subject_mapping?.status) && record.facts?.some((f) => f.target_field !== "不进入Excel")) errors.push("主体未确认时不得归属企业字段事实");
    const sources = record.sources ?? [];
    const sourceIds = new Set(sources.map((s) => s.source_id));
    const sourceById = new Map(sources.map((s) => [s.source_id, s]));
    for (const source of sources) {
      if (!String(source.title ?? "").trim()) errors.push(`来源${source.source_id || "(空)"}缺少标题`);
      if (!String(source.location ?? "").trim()) errors.push(`来源${source.source_id || "(空)"}缺少链接或保存位置`);
      if (!String(source.supports ?? "").trim()) errors.push(`来源${source.source_id || "(空)"}未写明支持范围`);
      if (source.source_type === "公开信息" && !String(source.cannot_support ?? "").trim()) errors.push(`公开来源${source.source_id || "(空)"}未写明证据边界`);
      if (source.source_type === "公开信息" && GENERIC_SOURCE_URL.test(String(source.location ?? ""))) warnings.push(`公开来源${source.source_id || "(空)"}仅登记站点首页，应升级为具体页面或附件`);
    }
    const factIds = new Set();
    for (const fact of record.facts ?? []) {
      if (!fact.fact_id || factIds.has(fact.fact_id)) errors.push(`事实ID缺失或重复：${fact.fact_id || "(空)"}`);
      factIds.add(fact.fact_id);
      if (!FIELDS.has(fact.target_field)) errors.push(`未知目标字段：${fact.target_field}`);
      if (!sourceIds.has(fact.source_id)) errors.push(`事实${fact.fact_id}引用了不存在的来源${fact.source_id}`);
      if (["公开确认", "企业自述", "待核线索"].includes(fact.evidence_status) && sourceById.get(fact.source_id)?.source_type !== "公开信息") errors.push(`事实${fact.fact_id}的公开证据状态与来源类型不一致`);
      if (fact.evidence_status === "内部评价") errors.push(`事实${fact.fact_id}把内部评价混入事实层`);
      if (fact.target_field === "核心人员公开联系方式") {
        const text = fact.excel_text || fact.fact_text || "";
        if (!hasNamedContact(text) || PUBLIC_CONTACT_BAD.test(text)) errors.push(`事实${fact.fact_id}不符合个人公开联系方式口径`);
      }
      if ((fact.fact_text || "").length > 400) warnings.push(`事实${fact.fact_id}过长，建议继续原子化`);
    }
    const materials = record.initial_materials ?? [];
    for (const material of materials) {
      if (!sourceIds.has(material.source_id)) errors.push(`现场笔记${material.material_id}引用了不存在的来源${material.source_id}`);
      if (material.linked_enterprise_name !== record.input_name) errors.push(`现场笔记${material.material_id}与企业名称未保持同一行绑定`);
      if (record.status === "researched" && material.link_status !== "confirmed") errors.push(`现场笔记${material.material_id}尚未确认企业归属`);
      if (record.status === "researched" && material.processing_status !== "extracted") errors.push(`现场笔记${material.material_id}尚未完成原子化拆解`);
      if (record.status === "researched" && !(material.extracted_fact_ids ?? []).length) errors.push(`现场笔记${material.material_id}没有登记拆解后的事实或待核线索`);
      for (const id of material.extracted_fact_ids ?? []) if (!factIds.has(id)) errors.push(`现场笔记${material.material_id}引用了不存在的事实${id}`);
    }
    const fieldOutputs = record.field_outputs ?? {};
    for (const field of FIELD_LIST) {
      const output = fieldOutputs[field];
      if (!output) {
        errors.push(`缺少Excel字段呈现层：${field}`);
        continue;
      }
      for (const id of output.basis_fact_ids ?? []) if (!factIds.has(id)) errors.push(`字段${field}引用了不存在的事实${id}`);
      const onsiteBasis = (output.basis_fact_ids ?? []).map((id) => (record.facts ?? []).find((fact) => fact.fact_id === id)).filter((fact) => fact?.source_type === "大赛现场");
      if (onsiteBasis.some((fact) => fact.evidence_status === "现场陈述") && !String(output.text ?? "").includes("现场陈述｜")) errors.push(`字段${field}使用现场陈述但未标注证据边界`);
      if (onsiteBasis.some((fact) => fact.evidence_status === "现场观察") && !String(output.text ?? "").includes("现场观察｜")) errors.push(`字段${field}使用现场观察但未标注证据边界`);
      const lines = String(output.text ?? "").split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > 5 && field !== "融资及投资机构背景") warnings.push(`字段${field}超过5行，需继续结构化压缩但不得删事实`);
    }
    for (const id of record.assessment?.basis_fact_ids ?? []) if (!factIds.has(id)) errors.push(`评价引用了不存在的事实${id}`);
    if (!["A", "B", "C", "D"].includes(record.assessment?.rating)) errors.push("初步评级无效");
    if (record.status === "pending_research") errors.push("尚未完成公开检索");
    if (!(record.sources ?? []).length && record.status !== "mapping_blocked") errors.push("没有登记任何来源");
    const audit = record.research_audit ?? {};
    if (materials.length && record.status === "researched") {
      if (audit.onsite_notes_ingested !== true) errors.push("大赛现场笔记尚未完成首批输入登记");
      if (audit.onsite_notes_decomposed !== true) errors.push("大赛现场笔记尚未完成原子化拆解");
      if (audit.onsite_notes_public_crosschecked !== true) errors.push("大赛现场笔记中的可核验主张尚未完成公开交叉检索");
    }
    if (record.status === "researched" && audit.mode !== "full_deep_research") errors.push("批量首轮成果必须执行full_deep_research，而不是覆盖扫描或增量模式");
    const rounds = audit.rounds ?? {};
    for (const roundId of REQUIRED_ROUNDS) {
      const round = rounds[roundId];
      if (!round || !["complete", "not_applicable"].includes(round.status)) {
        errors.push(`深检轮次未完成：${roundId}`);
        continue;
      }
      if ((round.remaining_tasks ?? []).length) errors.push(`深检轮次仍有遗留任务：${roundId}｜${round.remaining_tasks.join("；")}`);
      for (const id of round.new_fact_ids ?? []) if (!factIds.has(id)) errors.push(`深检轮次${roundId}引用了不存在的事实${id}`);
    }
    if ((audit.anchor_queue ?? []).length) errors.push(`仍有未反查高价值锚点：${audit.anchor_queue.join("；")}`);
    if ((audit.weak_source_upgrade_queue ?? []).length) errors.push(`仍有弱来源待升级：${audit.weak_source_upgrade_queue.join("；")}`);
    if ((audit.conflict_queue ?? []).length) errors.push(`仍有来源冲突待处理：${audit.conflict_queue.join("；")}`);
    for (const flag of REQUIRED_AUDIT_FLAGS) if (record.status === "researched" && audit[flag] !== true) errors.push(`深检审计未完成：${flag}`);
    const channelChecks = audit.channel_checks ?? {};
    for (const channel of REQUIRED_CHANNEL_CHECKS) {
      const check = channelChecks[channel];
      if (!check || !["checked", "not_applicable", "blocked"].includes(check.status)) errors.push(`缺少必查渠道审计：${channel}`);
      else if (check.status === "blocked") errors.push(`必查渠道仍被阻塞：${channel}`);
    }
    const fieldChecks = audit.field_checks ?? {};
    for (const field of FIELD_LIST) {
      const check = fieldChecks[field];
      if (!check) {
        errors.push(`缺少字段检索审计：${field}`);
        continue;
      }
      if (!["found", "searched_no_public_result", "blocked", "not_applicable"].includes(check.status)) errors.push(`字段检索状态无效：${field}`);
      if (check.status === "found" && !(check.fact_ids ?? []).some((id) => factIds.has(id))) errors.push(`字段标记found但没有有效事实ID：${field}`);
      if (check.status === "found" && !String(fieldOutputs[field]?.text ?? "").trim()) errors.push(`字段标记found但Excel呈现层为空：${field}`);
      if (check.status === "found") {
        const basis = new Set(fieldOutputs[field]?.basis_fact_ids ?? []);
        for (const id of check.fact_ids ?? []) if (!basis.has(id)) errors.push(`字段${field}的检索事实未进入Excel呈现层：${id}`);
      }
      if (check.status === "searched_no_public_result" && new Set(check.paths ?? []).size < 2) errors.push(`空白字段未完成两条不同路径补查：${field}`);
      if (check.status === "blocked") errors.push(`字段检索仍被阻塞：${field}`);
    }
    const inherited = record.legacy_inheritance ?? {};
    if (inherited.required && !inherited.completed) errors.push("检测到历史Excel，但尚未完成旧成果继承审计");
    if ((inherited.unresolved_losses ?? []).length) errors.push(`历史事实仍有未解释丢失：${inherited.unresolved_losses.join("；")}`);
    const foundPeople = new Set(audit.person_anchors_found ?? []);
    const reviewedPeople = new Set(audit.person_anchors_reviewed ?? []);
    for (const person of foundPeople) if (!reviewedPeople.has(person)) errors.push(`跨列人物锚点尚未反查：${person}`);
    const investors = new Set(audit.confirmed_investors ?? []);
    const completedInvestors = new Set(audit.investor_background_completed_for ?? []);
    for (const investor of investors) if (!completedInvestors.has(investor)) errors.push(`已确认投资方未逐家补充背景：${investor}`);
    if (investors.size && String(fieldOutputs["融资及投资机构背景"]?.text ?? "").trim()) {
      for (const investor of investors) if (!fieldOutputs["融资及投资机构背景"].text.includes(investor)) errors.push(`已确认投资方未进入Excel融资列：${investor}`);
    }
    const highValueFields = new Set((record.facts ?? []).filter((f) => f.valid_status === "当前有效" && f.evidence_status !== "待核线索").map((f) => f.target_field));
    if (highValueFields.size < 3) errors.push("可用于客户经理输出的已核字段少于3类，不能作为完整深检成果交付");
    review.push({ enterprise_id: record.enterprise_id, enterprise_name: record.enterprise_name, status: errors.length ? "blocked" : "ready_for_review", errors, warnings, fact_count: (record.facts ?? []).length, source_count: (record.sources ?? []).length });
  }
  const validation = { batch_id: manifest.batch_id, checked_at: new Date().toISOString(), passed: review.every((r) => !r.errors.length), ready_count: review.filter((r) => !r.errors.length).length, blocked_count: review.filter((r) => r.errors.length).length, companies: review };
  await fs.mkdir(path.join(runDir, "review"), { recursive: true });
  await fs.writeFile(path.join(runDir, "review", "validation.json"), `${JSON.stringify(validation, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(runDir, "review", "review-queue.jsonl"), `${review.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return validation;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = argsOf(process.argv.slice(2));
  if (!args.run) throw new Error("Usage: validate-run.mjs --run <批次目录>");
  const result = await validateRun(path.resolve(args.run));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 2);
}
