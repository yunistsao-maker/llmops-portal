// Assemble the static portal into dist/: prebuilt app shell (site/) + validated data (data/),
// test runs (runs/) and example config (config/), then write data/manifest.json, which the
// app reads to discover digests, models and runs. Data-only changes need no JS rebuild.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

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
  // what the build put on the site, so a post-deploy check can confirm the live site shows this version
  radarAsOf: existsSync(`${root}data/radar.json`) ? JSON.parse(readFileSync(`${root}data/radar.json`, "utf8")).asOf : null,
  release: existsSync(`${root}.portal-release.json`) ? JSON.parse(readFileSync(`${root}.portal-release.json`, "utf8")).releaseId : null,
};
writeFileSync(`${dist}/data/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

// Daily versions (tools/fetch_release.mjs + tools/build_versions.py): data/versions/<date>/ mirrors data/ for each of
// the 6 days before today; data/versions.json lists the 7 days for the version menu on every page. Today is data/.
const taipeiToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const listed = existsSync(`${root}.portal-versions.json`) ? JSON.parse(readFileSync(`${root}.portal-versions.json`, "utf8")) : null;
const days = listed?.days?.length ? listed.days : [{ date: taipeiToday, releaseId: manifest.release, publishedAt: null }];
const index = [];
days.forEach((d, i) => {
  const entry = { date: d.date, releaseId: d.releaseId ?? null, publishedAt: d.publishedAt ?? null, latest: i === 0 };
  if (i > 0) {
    const src = `${root}versions/${d.date}/data`;
    if (!existsSync(src)) return; // fetch_release found no release for that day
    const out = `${dist}/data/versions/${d.date}`;
    cpSync(src, out, { recursive: true });
    const vm = {
      generatedAt: manifest.generatedAt,
      digests: jsonIn(`${src}/digests`).map((f) => f.replace(/\.json$/, "")),
      models: jsonIn(`${src}/models`).map((f) => f.replace(/\.json$/, "")),
      compatRuns: manifest.compatRuns, perfRuns: manifest.perfRuns, // test results are not versioned
      hasInventory: existsSync(`${src}/internal/platform-inventory.json`),
      radarAsOf: existsSync(`${src}/radar.json`) ? JSON.parse(readFileSync(`${src}/radar.json`, "utf8")).asOf : null,
      release: d.releaseId, version: d.date,
    };
    writeFileSync(`${out}/manifest.json`, JSON.stringify(vm, null, 2) + "\n");
    entry.radarAsOf = vm.radarAsOf;
  } else {
    entry.radarAsOf = manifest.radarAsOf;
  }
  index.push(entry);
});
writeFileSync(`${dist}/data/versions.json`, JSON.stringify({ schema: "portal-versions/v1", today: index[0]?.date ?? taipeiToday, versions: index }, null, 2) + "\n");
console.log(`built dist/: ${manifest.digests.length} digests, ${manifest.models.length} models; versions ${index.map((v) => v.date).join(", ")}`);
