// Assemble the static portal into dist/: prebuilt app shell (site/) + validated data (data/),
// test runs (runs/) and example config (config/), then write data/manifest.json, which the
// app reads to discover digests, models and runs. Data-only changes need no JS rebuild.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dist = `${root}dist`;
const jsonIn = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(`${root}site`, dist, { recursive: true });
for (const dir of ["data", "runs", "config"]) cpSync(`${root}${dir}`, `${dist}/${dir}`, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  digests: jsonIn(`${root}data/digests`).map((f) => f.replace(/\.json$/, "")),
  models: jsonIn(`${root}data/models`).map((f) => f.replace(/\.json$/, "")),
  compatRuns: jsonIn(`${root}runs/compat`),
  perfRuns: jsonIn(`${root}runs/perf`),
  hasInventory: existsSync(`${root}data/internal/platform-inventory.json`),
};
writeFileSync(`${dist}/data/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`built dist/: ${manifest.digests.length} digests, ${manifest.models.length} models`);
