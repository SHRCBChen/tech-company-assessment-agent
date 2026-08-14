import fs from "node:fs/promises";
import path from "node:path";

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  return out;
}

function key(text) {
  return String(text ?? "").replace(/\s+/g, "").toLowerCase();
}

function nowDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
}

const args = argsOf(process.argv.slice(2));
if (!args.run || !args.update) throw new Error("Usage: apply-visit-update.mjs --run <批次目录> --update <审核后的增量.json>");
const runDir = path.resolve(args.run);
const updateFile = path.resolve(args.update);
const manifestPath = path.join(runDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const update = JSON.parse(await fs.readFile(updateFile, "utf8"));
const company = manifest.companies.find((item) => [item.enterprise_name, item.input_name].some((name) => key(name) === key(update.enterprise_name)));
if (!company) throw new Error(`批次内未找到企业：${update.enterprise_name}`);
const recordPath = path.join(runDir, company.record_file);
const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
const existingSources = new Set((record.sources ?? []).map((item) => item.source_id));
const existingFacts = new Set((record.facts ?? []).map((item) => item.fact_id));
for (const source of update.sources ?? []) {
  if (existingSources.has(source.source_id)) throw new Error(`来源ID重复：${source.source_id}`);
  existingSources.add(source.source_id);
}
for (const fact of update.facts ?? []) {
  if (existingFacts.has(fact.fact_id)) throw new Error(`事实ID重复：${fact.fact_id}`);
  if (!existingSources.has(fact.source_id)) throw new Error(`新增事实${fact.fact_id}引用了不存在的来源${fact.source_id}`);
  if (fact.replaces_fact_id) {
    const replaced = (record.facts ?? []).find((item) => item.fact_id === fact.replaces_fact_id);
    if (!replaced) throw new Error(`新增事实${fact.fact_id}拟替代的事实不存在：${fact.replaces_fact_id}`);
    replaced.valid_status = "已替代";
  }
  existingFacts.add(fact.fact_id);
}
record.sources = [...(record.sources ?? []), ...(update.sources ?? [])];
record.facts = [...(record.facts ?? []), ...(update.facts ?? [])];
if (update.assessment) record.assessment = { ...record.assessment, ...update.assessment };
record.status = "researched";
record.version_history = [...(record.version_history ?? []), { date: update.update_date || nowDate(), version: update.update_type, change: `导入${update.update_type}增量：${path.basename(updateFile)}` }];
await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
const copiedUpdate = path.join(runDir, "updates", `${nowDate()}-${path.basename(updateFile)}`);
await fs.copyFile(updateFile, copiedUpdate);
manifest.current_stage = "update_imported_rebuild_required";
manifest.updated_at = new Date().toISOString();
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "UPDATE_APPLIED", enterprise: record.enterprise_name, added_sources: (update.sources ?? []).length, added_facts: (update.facts ?? []).length, next: `重新运行 build-deliverables.mjs --run "${runDir}"` }, null, 2));
