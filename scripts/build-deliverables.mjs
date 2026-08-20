import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { validateRun } from "./validate-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIELD_HEADERS = ["核心人员", "核心人员背景", "核心人员公开联系方式", "主要产品", "核心技术及应用场景", "产业化进展及客户线索", "科创资质及科技项目", "知识产权及技术成果", "上下游", "竞争对手", "融资及投资机构背景", "公开风险事项"];
const RATING = { A: "优先调研", B: "重点跟踪", C: "持续观察", D: "信息待补" };

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

function safeCellText(text) {
  return String(text ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function md(text) {
  return safeCellText(text).replace(/\|/g, "｜").replace(/\n/g, "；");
}

function activeFacts(record, field) {
  const seen = new Set();
  return (record.facts ?? [])
    .filter((fact) => fact.target_field === field && !["已替代", "存在冲突"].includes(fact.valid_status) && fact.evidence_status !== "内部评价")
    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
    .filter((fact) => {
      const key = safeCellText(fact.excel_text || fact.fact_text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function displayFact(fact) {
  const prefix = { "企业自述": "企业自述｜", "现场陈述": "现场陈述｜", "现场观察": "现场观察｜", "待核线索": "待核线索｜" }[fact.evidence_status] ?? "";
  return `${prefix}${safeCellText(fact.excel_text || fact.fact_text)}`;
}

function excelCell(record, field) {
  const output = record.field_outputs?.[field];
  if (output && safeCellText(output.text)) return safeCellText(output.text);
  return activeFacts(record, field).map(displayFact).join("\n");
}

function sourceMap(record) {
  return new Map((record.sources ?? []).map((source) => [source.source_id, source]));
}

function endSentence(text) {
  const value = safeCellText(text).replace(/｜/g, "，");
  if (!value) return "";
  return /[。！？]$/.test(value) ? value : `${value}。`;
}

function reportLine(field, raw) {
  let text = safeCellText(raw).replace(/^(企业自述|现场陈述|现场观察|待核线索)｜/, "$1显示，");
  const divider = text.indexOf("｜");
  const label = divider >= 0 ? text.slice(0, divider).trim() : "";
  const value = divider >= 0 ? text.slice(divider + 1).trim() : text;
  const exact = {
    "核心人员": `企业核心团队及主要治理人员包括${value}`,
    "核心人员背景": label ? `${label}的公开履历或现场信息显示，${value}` : value,
    "核心人员公开联系方式": `公开可确认的核心人员联系方式为${value}`,
    "主要产品": `企业的产品布局主要围绕${value}`,
    "核心技术及应用场景": label ? `${label === "应用场景" ? "产品主要应用于" : `${label}主要包括`}${value}` : value,
    "产业化进展及客户线索": label ? `${label}方面，${value}` : value,
    "科创资质及科技项目": label === "资质" ? `公开资质显示，企业为${value}` : (label ? `${label}方面，${value}` : value),
    "知识产权及技术成果": label ? `${label}方面，${value}` : value,
    "上下游": label === "上游" ? `其上游主要包括${value}` : (label === "下游" ? `下游主要面向${value}` : (label ? `${label}方面，${value}` : value)),
    "竞争对手": `从同类产品和应用场景看，可能形成竞争或替代关系的厂商包括${value}`,
    "融资及投资机构背景": label === "融资阶段" ? `资本层面，企业已完成${value}` : (label ? `${label}的公开信息显示，${value}` : value)
  };
  return endSentence(exact[field] || (label ? `${label}方面，${value}` : value));
}

function reportSection(record, title, fields) {
  const paragraphs = [];
  for (const field of fields) {
    const output = excelCell(record, field);
    if (!output) continue;
    const sentences = output.split(/\r?\n/).filter(Boolean).map((line) => reportLine(field, line)).filter(Boolean);
    if (sentences.length) paragraphs.push(sentences.join(""));
  }
  return paragraphs.length ? { title, body: paragraphs.join("\n\n") } : null;
}

function linkedAssessment(record) {
  const chains = record.assessment?.conclusion_chains ?? [];
  if (!chains.length) return safeCellText(record.assessment.summary);
  const paragraphs = chains.map((chain) => {
    const conclusion = endSentence(chain.conclusion);
    const reasoning = endSentence(chain.reasoning);
    const conditions = (chain.change_conditions ?? []).filter(Boolean);
    const conditionText = conditions.length ? endSentence(`可能改变当前判断的关键条件包括${conditions.join("；")}`) : "";
    return `${conclusion}${reasoning}${conditionText}`;
  });
  const summary = safeCellText(record.assessment.summary);
  return `${paragraphs.join("\n\n")}${summary ? `\n\n${summary}` : ""}`;
}

export function buildReport(record, date, disclaimer) {
  const sections = [];
  sections.push(`# ${record.enterprise_name}企业初评报告\n`);
  sections.push(`**报告日期：** ${date}　 **初步分层：${record.assessment.rating}（${RATING[record.assessment.rating]}）**\n`);
  sections.push(`> ${disclaimer}\n`);
  const numbered = [
    reportSection(record, "企业定位与产品逻辑", ["主要产品", "核心技术及应用场景"]),
    reportSection(record, "团队与研发基础", ["核心人员", "核心人员背景", "科创资质及科技项目", "知识产权及技术成果", "核心人员公开联系方式"]),
    reportSection(record, "产业化进展与市场位置", ["产业化进展及客户线索", "上下游", "竞争对手"]),
    reportSection(record, "融资与资本支持", ["融资及投资机构背景"])
  ].filter(Boolean);
  const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八"];
  numbered.forEach((section, index) => sections.push(`## ${chineseNumbers[index]}、${section.title}\n\n${section.body}\n`));
  const usedIds = new Set(Object.values(record.field_outputs ?? {}).flatMap((output) => output.basis_fact_ids ?? []));
  const extraSiteFacts = (record.facts ?? []).filter((fact) => fact.source_type === "大赛现场" && !usedIds.has(fact.fact_id) && !["已替代", "存在冲突"].includes(fact.valid_status));
  let nextNumber = numbered.length;
  if (extraSiteFacts.length) sections.push(`## ${chineseNumbers[nextNumber++]}、大赛现场信息\n\n${extraSiteFacts.map((fact) => endSentence(safeCellText(fact.fact_text).replace(/^现场(?:笔记|展示|陈述)(?:称|记录)?[，：:]?/, "现场信息显示，"))).join("")}\n`);
  const priorities = record.assessment.visit_priorities?.length ? `\n\n建议后续拜访围绕以下问题展开：\n\n${record.assessment.visit_priorities.map((item) => `- ${safeCellText(item)}`).join("\n")}` : "";
  sections.push(`## ${chineseNumbers[nextNumber]}、综合评价与拜访重点\n\n${linkedAssessment(record)}\n\n据此，企业初步分层为${record.assessment.rating}类（${RATING[record.assessment.rating]}）。${priorities}\n`);
  return sections.filter(Boolean).join("\n").replace(/｜/g, "：");
}

export function buildDossier(record, date) {
  const sources = sourceMap(record);
  const facts = (record.facts ?? []).filter((fact) => fact.valid_status !== "已替代");
  const factRows = facts.map((fact) => `| ${md(fact.fact_id)} | ${md(fact.fact_text)} | ${md(fact.fact_type)} | ${md(fact.source_id)} | ${md(fact.evidence_status)} | ${md(fact.fact_date || fact.valid_status)} | ${md(fact.confidence_note)} |`).join("\n") || "| — | — | — | — | — | — | — |";
  const sourceBlocks = [...sources.values()].map((source) => {
    const limitation = source.source_type === "大赛现场" ? "" : `\n- 不能支持：${md(source.cannot_support)}`;
    return `### ${md(source.source_id)}｜${md(source.title)}\n\n- 来源：${md(source.source_type)}\n- 链接/保存位置：${safeCellText(source.location)}\n- 获取/形成时间：${md(source.retrieved_at || source.published_at)}\n- 支持范围：${md(source.supports)}${limitation}`;
  }).join("\n\n") || "暂无来源登记。";
  const pending = [...(record.assessment.uncertainties ?? [])];
  const current = activeFacts(record, "主要产品").concat(activeFacts(record, "核心技术及应用场景")).slice(0, 3).map(displayFact).join("；");
  const progress = activeFacts(record, "产业化进展及客户线索").slice(0, 3).map(displayFact).join("；");
  const ratingReasonRaw = safeCellText(record.assessment.rating_reason || record.assessment.summary || "");
  const ratingReason = ratingReasonRaw.split(/[。；]/)[0].replace(/本评价.*$/, "").trim().slice(0, 90);
  const judgeComment = safeCellText(record.assessment.judge_comment || [...sources.values()].map((source) => source.supports || "").join("；").match(/(?:评委(?:评价|点评)?|专家点评)[：:]\s*([^。；\n]+)/)?.[1] || "").slice(0, 90);
  const judgeLine = judgeComment ? `\n- 现场评委意见：${judgeComment}` : "";
  const onsiteFacts = facts.filter((fact) => fact.evidence_status === "现场陈述" || sources.get(fact.source_id)?.source_type === "大赛现场");
  const onsiteBuckets = [/(团队|人员)/, /(产品|技术|应用)/, /(经营|客户|营收|订单|出货)/, /融资/, /(历程|规划|里程碑|量产|流片|中试|验证)/];
  const criticalOnsite = /(客户|出货|订单|定点|中标|营收|收入|融资|投资|量产|流片|验厂|中试|毛利|产值|回款|合同)/;
  const onsiteHighlights = onsiteBuckets.map((pattern) => onsiteFacts.find((fact) => pattern.test(`${fact.fact_type}${fact.fact_text}`))).filter(Boolean).map((fact) => {
    const text = safeCellText(fact.fact_text).replace(/^现场(?:笔记|展示|陈述)(?:称|记录)?/, "").slice(0, 75);
    return criticalOnsite.test(`${fact.fact_type}${fact.fact_text}`) && fact.evidence_status !== "公开确认" ? `${text}（待核验）` : text;
  });
  const onsiteLine = onsiteHighlights.length ? `\n- 现场要点：${[...new Set(onsiteHighlights)].join("；")}` : "";
  return `# ${record.enterprise_name}｜当前事实底稿\n\n> 本文件保存企业事实、证据边界和待核事项。Excel与初评报告是派生输出，不作为证据来源。\n\n## 1. 当前画像\n\n- 业务定位：${current}\n- 已确认进展：${progress}\n- 初步评级：${record.assessment.rating}（${RATING[record.assessment.rating]}）\n- 评级简要理由：${ratingReason}${judgeLine}${onsiteLine}\n\n## 2. 原子事实\n\n| 事实ID | 原子事实 | 类型 | 来源ID | 证据状态 | 时点/状态 | 边界说明 |\n|---|---|---|---|---|---|---|\n${factRows}\n\n## 3. 证据登记\n\n${sourceBlocks}\n\n## 4. 待核事实\n\n${pending.length ? pending.map((item) => `- ${safeCellText(item)}`).join("\n") : "暂无新增待核事实。"}\n\n## 5. 事实边界\n\n- 公开确认、企业自述、现场陈述、现场观察和待核线索不得混写。\n- 客户、合作、送样、定点、中标和量产分别表述。\n- 本底稿不承载派生报告中的分析性内容和后续行动安排。\n- 后续现场及拜访材料经审核后写入事实记录，再同步更新派生成果。\n`;
}

async function buildWorkbook(records, outputFile, previewFile) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("企业信息");
  const headers = ["企业名称", ...FIELD_HEADERS];
  const rows = records.map((record) => [record.enterprise_name, ...FIELD_HEADERS.map((field) => excelCell(record, field))]);
  const all = [headers, ...rows];
  const range = sheet.getRangeByIndexes(0, 0, all.length, headers.length);
  range.values = all;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(1);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: "#17365D" } };
  if (rows.length) {
    const body = sheet.getRangeByIndexes(1, 0, rows.length, headers.length);
    body.format = { font: { color: "#1F2937" }, verticalAlignment: "top", horizontalAlignment: "left", wrapText: true, borders: { insideHorizontal: { style: "thin", color: "#D9E2F3" }, bottom: { style: "thin", color: "#B4C6E7" } } };
    body.format.rowHeight = 84;
    sheet.getRangeByIndexes(1, 0, rows.length, 1).format = { fill: "#D9EAF7", font: { bold: true, color: "#17365D" }, verticalAlignment: "top", wrapText: true };
  }
  const widths = [24, 22, 33, 26, 36, 44, 38, 34, 36, 28, 26, 40, 12];
  widths.forEach((width, col) => { sheet.getRangeByIndexes(0, col, all.length, 1).format.columnWidth = width; });
  sheet.tables.add(`A1:M${all.length}`, true, "EnterpriseResearchTable");
  const inspect = await workbook.inspect({ kind: "table", range: `企业信息!A1:M${Math.min(all.length, 6)}`, include: "values,formulas", tableMaxRows: 6, tableMaxCols: 13, maxChars: 5000 });
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, summary: "final formula error scan" });
  const preview = await workbook.render({ sheetName: "企业信息", range: `A1:M${Math.min(all.length, 4)}`, scale: 1, format: "png" });
  await fs.writeFile(previewFile, new Uint8Array(await preview.arrayBuffer()));
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputFile);
  return { inspect: inspect.ndjson, errors: errors.ndjson };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
const args = argsOf(process.argv.slice(2));
if (!args.run) throw new Error("Usage: build-deliverables.mjs --run <批次目录>");
const runDir = path.resolve(args.run);
const manifestPath = path.join(runDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const validation = await validateRun(runDir);
const records = await Promise.all(manifest.companies.map(async (company) => JSON.parse(await fs.readFile(path.join(runDir, company.record_file), "utf8"))));
const readyIds = new Set(validation.companies.filter((item) => item.status === "ready_for_review").map((item) => item.enterprise_id));
const ready = records.filter((record) => readyIds.has(record.enterprise_id));
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
const config = JSON.parse(await fs.readFile(path.join(ROOT, "config", "batch-agent.json"), "utf8"));
const excelFile = path.join(runDir, "deliverables", "excel", `${manifest.batch_name}｜企业信息主表.xlsx`);
const previewFile = path.join(runDir, "deliverables", "previews", "企业信息主表预览.png");
await fs.mkdir(path.dirname(excelFile), { recursive: true });
if (!validation.passed) {
  manifest.current_stage = "research_incomplete";
  manifest.updated_at = new Date().toISOString();
  manifest.deliverables = { excel: "", reports_dir: "", ima_ready_dir: "", preview: "", ready_count: ready.length, blocked_count: validation.blocked_count, ima_sync_status: "blocked_until_all_companies_pass" };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "DELIVERABLES_BLOCKED", batch_id: manifest.batch_id, total: records.length, ready: ready.length, blocked: validation.blocked_count, validation: path.join(runDir, "review", "validation.json") }, null, 2));
  process.exit(2);
}
const workbookCheck = await buildWorkbook(ready, excelFile, previewFile);
for (const record of ready) {
  await fs.writeFile(path.join(runDir, "deliverables", "reports", `${record.enterprise_name}｜企业初评报告.md`), buildReport(record, date, config.policies.report_disclaimer), "utf8");
  await fs.writeFile(path.join(runDir, "deliverables", "ima-ready", `${record.enterprise_name}｜当前事实底稿.md`), buildDossier(record, date), "utf8");
}
manifest.current_stage = validation.passed ? "review" : "review_with_blocked_items";
manifest.updated_at = new Date().toISOString();
manifest.deliverables = { excel: excelFile, reports_dir: path.join(runDir, "deliverables", "reports"), ima_ready_dir: path.join(runDir, "deliverables", "ima-ready"), preview: previewFile, ready_count: ready.length, blocked_count: validation.blocked_count, ima_sync_status: "waiting_for_review" };
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(runDir, "logs", "workbook-verification.json"), `${JSON.stringify(workbookCheck, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "DELIVERABLES_BUILT", batch_id: manifest.batch_id, total: records.length, ready: ready.length, blocked: validation.blocked_count, excel: excelFile, reports: path.join(runDir, "deliverables", "reports"), ima_ready: path.join(runDir, "deliverables", "ima-ready"), review_required_before_ima: true }, null, 2));
process.exit(validation.blocked_count ? 2 : 0);
}
