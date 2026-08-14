import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const FIELDS = ["核心人员", "核心人员背景", "核心人员公开联系方式", "主要产品", "核心技术及应用场景", "产业化进展及客户线索", "科创资质及科技项目", "知识产权及技术成果", "上下游", "竞争对手", "融资及投资机构背景"];
const NAME_HEADERS = new Set(["企业名称", "公司名称", "企业全称", "企业/项目名称", "项目名称"]);
const ALIASES = new Map([
  ["核心人员公开联系方式", ["核心人员公开联系方式", "核心人员联系方式"]],
  ["融资及投资机构背景", ["融资及投资机构背景", "融资情况及投资机构背景", "融资情况与投资机构背景"]]
]);
const compact = (value) => String(value ?? "").replace(/\s+/g, "").trim();
const cellText = (value) => String(value ?? "").replace(/\r/g, "").trim();

async function readCandidate(file) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheet = workbook.worksheets.getItemAt(0);
  const rows = sheet.getUsedRange(true)?.values ?? [];
  let headerRow = -1;
  let nameCol = -1;
  for (let r = 0; r < Math.min(20, rows.length); r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      if (NAME_HEADERS.has(cellText(rows[r][c]))) {
        headerRow = r;
        nameCol = c;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return null;
  const headers = rows[headerRow].map(cellText);
  const colOf = (field) => (ALIASES.get(field) ?? [field]).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const companies = {};
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const name = cellText(rows[r][nameCol]);
    if (!name) continue;
    companies[compact(name)] = { name, row: r + 1, fields: Object.fromEntries(FIELDS.map((field) => [field, colOf(field) >= 0 ? cellText(rows[r][colOf(field)]) : ""])) };
  }
  return { file, sheet: sheet.name, companies };
}

export async function collectLegacyAssets(runDir) {
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const books = [];
  for (const file of manifest.legacy_candidates ?? []) {
    try {
      const book = await readCandidate(file);
      if (book) books.push(book);
    } catch (error) {
      books.push({ file, error: error.message, companies: {} });
    }
  }
  const output = { generated_at: new Date().toISOString(), candidate_files: manifest.legacy_candidates ?? [], companies: [] };
  for (const company of manifest.companies) {
    const key = compact(company.enterprise_name || company.input_name);
    const matches = books.map((book) => ({ file: book.file, sheet: book.sheet, ...book.companies[key] })).filter((item) => item.name);
    const richest = {};
    for (const field of FIELDS) {
      const candidates = matches.map((item) => ({ file: item.file, row: item.row, value: item.fields[field] ?? "" })).filter((item) => item.value).sort((a, b) => b.value.length - a.value.length);
      richest[field] = candidates[0] ?? { file: "", row: 0, value: "" };
    }
    output.companies.push({ enterprise_id: company.enterprise_id, enterprise_name: company.enterprise_name, matches, richest_by_field: richest, old_nonempty_fields: FIELDS.filter((field) => richest[field].value) });
    const recordPath = path.join(runDir, company.record_file);
    const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
    record.legacy_inheritance ??= {};
    record.legacy_inheritance.required = matches.length > 0;
    record.legacy_inheritance.completed = matches.length === 0;
    record.legacy_inheritance.candidate_files = manifest.legacy_candidates ?? [];
    record.legacy_inheritance.matched_sources = matches.map((item) => item.file);
    record.legacy_inheritance.reverified_fact_ids ??= [];
    record.legacy_inheritance.regression_report = "review/legacy-assets.json";
    record.legacy_inheritance.unresolved_losses = matches.length ? FIELDS.filter((field) => richest[field].value).map((field) => `${field}：待继承/复核`) : [];
    await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  const outputPath = path.join(runDir, "review", "legacy-assets.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  manifest.legacy_asset_file = "review/legacy-assets.json";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { status: "LEGACY_ASSETS_COLLECTED", output: outputPath, matched_companies: output.companies.filter((item) => item.matches.length).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const index = process.argv.indexOf("--run");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: collect-legacy-assets.mjs --run <批次目录>");
  console.log(JSON.stringify(await collectLegacyAssets(path.resolve(process.argv[index + 1])), null, 2));
}
