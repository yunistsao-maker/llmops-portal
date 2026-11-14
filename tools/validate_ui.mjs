// Validate frontend/data/ui.json against schema/ui.schema.json (llmops-ui/v1), then check cross-references:
// every source id resolves, every tier/todo/board model id exists.   node tools/validate_ui.mjs
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "schema/ui.schema.json"), "utf8"));
const ui = JSON.parse(readFileSync(join(root, "frontend/data/ui.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const problems = [];
if (!validate(ui)) for (const e of validate.errors) problems.push(`schema ${e.instancePath || "/"} ${e.message}`);

const models = new Set((ui.models || []).map((m) => m.id));
const sources = new Set(Object.keys(ui.sources || {}));
const srcCheck = (where, ids) => (ids || []).forEach((id) => sources.has(id) || problems.push(`${where}: unknown source ${id}`));
(ui.tiers || []).forEach((t) => t.modelIds.forEach((id) => models.has(id) || problems.push(`tier ${t.id}: unknown model ${id}`)));
(ui.todos || []).forEach((t, i) => t.relatedModelIds.forEach((id) => models.has(id) || problems.push(`todo ${i}: unknown model ${id}`)));
(ui.board || []).forEach((c) => c.items.forEach((it) => !it.modelId || models.has(it.modelId) || problems.push(`board ${c.id}: unknown model ${it.modelId}`)));
(ui.priceBands || []).forEach((b) => b.models.forEach((m) => models.has(m.id) || problems.push(`band ${b.label}: unknown model ${m.id}`)));
(ui.news?.items || []).forEach((n, i) => srcCheck(`news ${i}`, n.sources));
(ui.watchlist || []).forEach((w) => srcCheck(`watch ${w.name}`, w.sources));
(ui.models || []).forEach((m) => {
  srcCheck(`model ${m.id}`, m.sources);
  Object.values(m.clouds).forEach((c) => srcCheck(`model ${m.id}/${c.service}`, c.sources));
});
for (const p of problems) console.error("✗ " + p);
if (problems.length) process.exit(1);
console.log(`✓ frontend/data/ui.json valid (llmops-ui/v1): ${ui.models.length} models, ${ui.news.items.length} news, ${Object.keys(ui.sources).length} sources`);
