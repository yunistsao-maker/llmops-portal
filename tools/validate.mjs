// Node/ajv validator — same checks as tools/validate_data.py (schema only), for the React/TypeScript side.
//   npm run validate
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "schema/llmops.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema, "llmops");

const list = (dir, pred = () => true) =>
  existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith(".json") && pred(f)).map((f) => join(dir, f)) : [];

const targets = [
  ["data/sources.json", "SourcesFile"],
  ["data/catalog.json", "CatalogFile"],
  ["data/lifecycle.json", "LifecycleFile"],
  ["data/litellm.json", "LiteLLMFile"],
  ["data/requirements.json", "RequirementsFile"],
  ...list("data/digests").map((f) => [f, "DigestFile"]),
  ...list("data/models").map((f) => [f, "DeepDive"]),
  ...list("data/internal", (f) => f.startsWith("platform-inventory")).map((f) => [f, "PlatformInventory"]),
  ...list("runs/perf").map((f) => [f, "PerfRun"]),
  ...list("runs/compat").map((f) => [f, "CompatRun"]),
];

let bad = 0;
for (const [file, def] of targets) {
  const validate = ajv.getSchema(`llmops#/definitions/${def}`);
  const ok = validate(JSON.parse(readFileSync(join(root, file), "utf8")));
  if (!ok) {
    bad++;
    console.log(`✗ ${file} (${def})`);
    for (const e of validate.errors.slice(0, 10)) console.log(`   ${e.instancePath || "/"} ${e.message}`);
  }
}
console.log(bad ? `${bad} file(s) invalid` : `✓ ${targets.length} file(s) valid (ajv)`);
process.exit(bad ? 1 : 0);
