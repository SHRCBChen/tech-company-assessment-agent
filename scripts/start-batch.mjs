import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { collectLegacyAssets } from "./collect-legacy-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME_HEADERS = new Set(["企业名称", "企业全称", "公司名称", "企业/项目名称", "参赛企业", "项目名称", "企业"]);
const NOTE_HEADERS = new Set(["大赛现场笔记", "大赛现场自由笔记", "现场笔记", "现场自由笔记", "比赛现场笔记", "现场记录", "自由笔记"]);

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

function compact(value) {
  return String(value ?? "").replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

function mergeEntries(values) {
  const byName = new Map();
  for (const value of values) {
    const name = compact(value?.input_name ?? value?.name ?? value);
    if (!name || NAME_HEADERS.has(name)) continue;
    const note = compact(value?.onsite_note ?? value?.note ?? "");
    const row = Number(value?.input_row ?? 0) || 0;
    if (!byName.has(name)) byName.set(name, { input_name: name, onsite_notes: [], input_rows: [] });
    const entry = byName.get(name);
    if (row) entry.input_rows.push(row);
    if (note && !entry.onsite_notes.some((item) => item.raw_text === note)) entry.onsite_notes.push({ raw_text: note, input_row: row });
  }
  return [...byName.values()];
}

async function entriesFromXlsx(file) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheet = workbook.worksheets.getItemAt(0);
  const used = sheet.getUsedRange(true);
  const rows = used?.values ?? [];
  if (!rows.length) return [];
  let headerRow = -1;
  let nameCol = -1;
  let noteCol = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      const header = compact(rows[r][c]);
      if (NAME_HEADERS.has(header)) nameCol = c;
      if (NOTE_HEADERS.has(header)) noteCol = c;
    }
    if (nameCol >= 0) { headerRow = r; break; }
  }
  if (nameCol >= 0) return { entries: mergeEntries(rows.slice(headerRow + 1).map((row, index) => ({ input_name: row[nameCol], onsite_note: noteCol >= 0 ? row[noteCol] : "", input_row: headerRow + index + 2 }))), note_column_found: noteCol >= 0 };
  const columnCounts = [];
  for (let c = 0; c < Math.max(...rows.map((r) => r.length)); c += 1) {
    columnCounts[c] = rows.filter((row) => compact(row[c])).length;
  }
  nameCol = columnCounts.indexOf(Math.max(...columnCounts));
  return { entries: mergeEntries(rows.map((row, index) => ({ input_name: row[nameCol], input_row: index + 1 }))), note_column_found: false };
}

async function readEntries(file) {
  const ext = path.extname(file).toLowerCase();
  if ([".xlsx", ".xls"].includes(ext)) return entriesFromXlsx(file);
  const text = await fs.readFile(file, "utf8");
  if (ext === ".json") {
    const value = JSON.parse(text);
    const rows = Array.isArray(value) ? value : value.enterprises ?? value.companies ?? [];
    const entries = mergeEntries(rows.map((row, index) => typeof row === "string" ? { input_name: row, input_row: index + 1 } : { input_name: row.企业名称 ?? row.enterprise_name ?? row.name, onsite_note: row.大赛现场笔记 ?? row.大赛现场自由笔记 ?? row.现场笔记 ?? row.onsite_note ?? row.note, input_row: index + 1 }));
    return { entries, note_column_found: rows.some((row) => typeof row === "object" && row && Object.keys(row).some((key) => NOTE_HEADERS.has(key) || ["onsite_note", "note"].includes(key))) };
  }
  const lines = text.split(/\r?\n/).filter((line) => compact(line));
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const parts = lines.map((line) => line.split(delimiter));
  const hasHeader = NAME_HEADERS.has(compact(parts[0]?.[0]));
  const noteColumnFound = hasHeader ? NOTE_HEADERS.has(compact(parts[0]?.[1])) : parts.some((row) => compact(row.slice(1).join(delimiter)));
  return { entries: mergeEntries(parts.slice(hasHeader ? 1 : 0).map((row, index) => ({ input_name: row[0], onsite_note: row.slice(1).join(delimiter), input_row: index + (hasHeader ? 2 : 1) }))), note_column_found: noteColumnFound };
}

async function findLegacyCandidates(config) {
  const candidates = [];
  for (const configured of config.legacy_search_roots ?? []) {
    const root = path.resolve(ROOT, configured);
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /\.(xlsx|xls)$/i.test(entry.name)) candidates.push(path.join(root, entry.name));
      }
    } catch {}
  }
  return candidates;
}

function timestamp() {
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  return p.replace(/[-: ]/g, "");
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48);
}

function enterpriseId(name) {
  return `E${crypto.createHash("sha256").update(name, "utf8").digest("hex").slice(0, 10).toUpperCase()}`;
}

const args = argsOf(process.argv.slice(2));
if (!args.input) throw new Error("Usage: start-batch.mjs --input <企业名单.xlsx|txt|json> [--name 批次名] [--limit 5]");
const input = path.resolve(args.input);
let { entries, note_column_found: noteColumnFound } = await readEntries(input);
if (args.limit) entries = entries.slice(0, Number(args.limit));
if (!entries.length) throw new Error("没有从输入文件中识别出企业或项目名称。");
if (args["require-onsite-notes"] && !noteColumnFound) throw new Error("输入文件缺少大赛现场笔记列。请将企业名称与大赛现场笔记放在同一行后重试。");

const batchName = compact(args.name) || path.basename(input, path.extname(input));
const batchId = `${timestamp()}-${safeName(batchName)}`;
const runDir = path.join(ROOT, "runs", batchId);
for (const dir of ["records", "review", "deliverables/excel", "deliverables/ima-ready", "deliverables/reports", "deliverables/previews", "updates", "logs"]) {
  await fs.mkdir(path.join(runDir, dir), { recursive: true });
}

const template = JSON.parse(await fs.readFile(path.join(ROOT, "templates", "research-record-template.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(ROOT, "config", "batch-agent.json"), "utf8"));
const legacyCandidates = await findLegacyCandidates(config);
const companies = [];
for (const entry of entries) {
  const name = entry.input_name;
  const id = enterpriseId(name);
  const record = structuredClone(template);
  Object.assign(record, { enterprise_id: id, enterprise_name: name, input_name: name });
  record.initial_materials = entry.onsite_notes.map((note, index) => ({ material_id: `M-ONSITE-${String(index + 1).padStart(3, "0")}`, material_type: "大赛现场自由笔记", source_id: `S-ONSITE-${String(index + 1).padStart(3, "0")}`, linked_enterprise_name: name, link_status: "row_bound", input_row: note.input_row, raw_text: note.raw_text, processing_status: "pending_extraction", extracted_fact_ids: [] }));
  record.sources = record.initial_materials.map((material) => ({ source_id: material.source_id, title: `大赛现场自由笔记（导入第${material.input_row || "?"}行）`, location: `${input}#row=${material.input_row || ""}`, source_type: "大赛现场", published_at: "", retrieved_at: new Date().toISOString(), supports: `原始笔记：${material.raw_text}`, cannot_support: "不能单独证明客户关系、融资完成、量产、资质认定、专利权属或其他需外部核验事项；须先原子化拆解并与公开信息交叉核验。" }));
  record.legacy_inheritance.required = legacyCandidates.length > 0;
  record.legacy_inheritance.candidate_files = legacyCandidates;
  await fs.writeFile(path.join(runDir, "records", `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  companies.push({ enterprise_id: id, input_name: name, enterprise_name: name, onsite_note_count: entry.onsite_notes.length, status: "pending_research", record_file: `records/${id}.json` });
}

const manifest = {
  schema_version: "1.0",
  batch_id: batchId,
  batch_name: batchName,
  input_file: input,
  created_at: new Date().toISOString(),
  current_stage: "research",
  quality_mode: config.quality_mode ?? "full_deep_research_strict",
  legacy_candidates: legacyCandidates,
  input_binding: { mode: "enterprise_name_and_onsite_notes_same_row", note_column_found: noteColumnFound, total_note_count: entries.reduce((sum, item) => sum + item.onsite_notes.length, 0), enterprises_without_notes: entries.filter((item) => !item.onsite_notes.length).map((item) => item.input_name) },
  policies: { ima_upload: "after_review", outputs: ["11列企业主表Excel", "ima当前事实底稿", "1-2页企业初评报告"], formal_delivery_requires_all_companies_pass: true },
  companies
};
await fs.writeFile(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const legacy = await collectLegacyAssets(runDir);
await fs.writeFile(path.join(ROOT, "runs", "latest-run.txt"), `${runDir}\n`, "utf8");

console.log(JSON.stringify({ status: "BATCH_READY", batch_id: batchId, run_dir: runDir, enterprise_count: companies.length, enterprises: entries.map((item) => item.input_name), onsite_note_count: manifest.input_binding.total_note_count, enterprises_without_notes: manifest.input_binding.enterprises_without_notes, legacy_assets: legacy }, null, 2));
process.exit(0);
