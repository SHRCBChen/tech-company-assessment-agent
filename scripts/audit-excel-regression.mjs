import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const FIELDS = ["核心人员", "核心人员背景", "核心人员公开联系方式", "主要产品", "核心技术及应用场景", "产业化进展及客户线索", "科创资质及科技项目", "知识产权及技术成果", "产业链上下游", "竞争对手", "融资及投资机构背景"];
const NAME_HEADERS = new Set(["企业名称", "公司名称", "企业全称", "企业/项目名称", "项目名称"]);

function argsOf(argv) {
  const out = { old: [], company: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--old") out.old.push(argv[++i]);
    else if (argv[i] === "--new") out.new = argv[++i];
    else if (argv[i] === "--company") out.company.push(argv[++i]);
    else if (argv[i] === "--output") out.output = argv[++i];
  }
  return out;
}

const compact = (value) => String(value ?? "").replace(/\s+/g, "").trim();
const text = (value) => String(value ?? "").replace(/\r/g, "").trim();

async function readWorkbook(file) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path.resolve(file)));
  const sheet = workbook.worksheets.getItemAt(0);
  const rows = sheet.getUsedRange(true)?.values ?? [];
  let headerRow = -1;
  let nameCol = -1;
  for (let r = 0; r < Math.min(20, rows.length); r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      if (NAME_HEADERS.has(text(rows[r][c]))) {
        headerRow = r;
        nameCol = c;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) throw new Error(`未找到企业名称表头：${file}`);
  const headers = rows[headerRow].map(text);
  const aliases = new Map([
    ["核心人员公开联系方式", ["核心人员公开联系方式", "核心人员联系方式"]],
    ["产业链上下游", ["产业链上下游", "上下游"]],
    ["融资及投资机构背景", ["融资及投资机构背景", "融资情况及投资机构背景", "融资情况与投资机构背景"]]
  ]);
  const colOf = (field) => {
    const names = aliases.get(field) ?? [field];
    return headers.findIndex((h) => names.includes(h));
  };
  const companies = {};
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const name = text(rows[r][nameCol]);
    if (!name) continue;
    companies[compact(name)] = {
      name,
      row: r + 1,
      fields: Object.fromEntries(FIELDS.map((field) => {
        const col = colOf(field);
        return [field, col >= 0 ? text(rows[r][col]) : ""];
      }))
    };
  }
  return { file: path.resolve(file), sheet: sheet.name, companies };
}

const args = argsOf(process.argv.slice(2));
if (!args.old.length || !args.new || !args.company.length) throw new Error("Usage: audit-excel-regression.mjs --old old.xlsx [--old old2.xlsx] --new new.xlsx --company 企业名 [--company 企业名] --output audit.json");
const oldBooks = [];
for (const file of args.old) oldBooks.push(await readWorkbook(file));
const newBook = await readWorkbook(args.new);
const result = { generated_at: new Date().toISOString(), old_files: oldBooks.map((b) => b.file), new_file: newBook.file, companies: [] };
for (const companyName of args.company) {
  const key = compact(companyName);
  const current = newBook.companies[key];
  const oldRows = oldBooks.map((book) => ({ file: book.file, row: book.companies[key] })).filter((item) => item.row);
  const fields = [];
  for (const field of FIELDS) {
    const oldValues = oldRows.map((item) => ({ file: item.file, value: item.row.fields[field], length: item.row.fields[field].length })).filter((item) => item.value);
    const richest = oldValues.sort((a, b) => b.length - a.length)[0] ?? { value: "", length: 0, file: "" };
    const newValue = current?.fields[field] ?? "";
    fields.push({ field, old_richest_length: richest.length, new_length: newValue.length, change: newValue.length - richest.length, lost: richest.length > 0 && (newValue.length === 0 || newValue.length < richest.length * 0.6), old_value: richest.value, new_value: newValue, old_source_file: richest.file });
  }
  result.companies.push({ company: companyName, found_in_new: Boolean(current), old_sources_found: oldRows.length, old_nonempty: fields.filter((f) => f.old_richest_length).length, new_nonempty: fields.filter((f) => f.new_length).length, lost_fields: fields.filter((f) => f.lost).map((f) => f.field), fields });
}
const output = path.resolve(args.output ?? "regression-audit.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "AUDIT_COMPLETE", output, companies: result.companies.map((c) => ({ company: c.company, old_nonempty: c.old_nonempty, new_nonempty: c.new_nonempty, lost_fields: c.lost_fields })) }, null, 2));
