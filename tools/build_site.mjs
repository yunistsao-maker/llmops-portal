// Assemble the static portal into dist/: prebuilt app shell (site/) + validated data (data/),
// test runs (runs/) and example config (config/), then write data/manifest.json, which the
// app reads to discover digests, models and runs. Data-only changes need no JS rebuild.
//
// PORTAL_EDITION (Amplify environment variable): "full" (default) = the platform team's portal (site/);
// "clean" = the portal for everyone who needs the latest LLM information (site-clean/): no 發布流程,
// LiteLLM 與安全, 上手指南, Onboarding tab or AI security test demo - and none of their data: the deep dives lose
// `onboarding`; data/litellm.json and config/ (the gateway example) are left out. Test results (runs/) and the documented
// LiteLLM provider matrix (data/provider-compatibility.json, 方法與來源 → 測試方法) stay. Test results: the
// model page's 內部測試 tab shows them.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dist = `${root}dist`;
const jsonIn = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
const edition = (process.env.PORTAL_EDITION || "full").trim();
if (!["full", "clean"].includes(edition)) throw new Error(`PORTAL_EDITION must be full or clean, not ${JSON.stringify(edition)}`);
const app = edition === "clean" ? "site-clean" : "site";

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(`${root}${app}`, dist, { recursive: true });
for (const dir of edition === "clean" ? ["data", "runs"] : ["data", "runs", "config"]) {
  if (existsSync(`${root}${dir}`)) cpSync(`${root}${dir}`, `${dist}/${dir}`, { recursive: true });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  digests: jsonIn(`${root}data/digests`).map((f) => f.replace(/\.json$/, "")),
  models: jsonIn(`${root}data/models`).map((f) => f.replace(/\.json$/, "")),
  compatRuns: jsonIn(`${root}runs/compat`),
  perfRuns: jsonIn(`${root}runs/perf`),
  securityRuns: jsonIn(`${root}runs/security`).filter((f) => !f.endsWith(".cases.json")),
  // the redacted case-by-case results: the full portal only (the clean build removes the files below)
  securityCases: edition === "clean" ? [] : jsonIn(`${root}runs/security`).filter((f) => f.endsWith(".cases.json")),
  hasInventory: existsSync(`${root}data/internal/platform-inventory.json`),
  // what the build put on the site, so a post-deploy check can confirm the live site shows this version
  radarAsOf: existsSync(`${root}data/radar.json`) ? JSON.parse(readFileSync(`${root}data/radar.json`, "utf8")).asOf : null,
  release: existsSync(`${root}.portal-release.json`) ? JSON.parse(readFileSync(`${root}.portal-release.json`, "utf8")).releaseId : null,
  edition,
};
writeFileSync(`${dist}/data/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

// Daily versions (tools/fetch_release.mjs + tools/build_versions.py): data/versions/<date>/ mirrors data/ for each of
// the 29 days before today; data/versions.json lists the 30 days for the version menu on every page. Today is data/.
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
      compatRuns: manifest.compatRuns, perfRuns: manifest.perfRuns, securityRuns: manifest.securityRuns, securityCases: manifest.securityCases, // test results are not versioned
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

// The clean edition: what its pages do not show is not in its files either.
if (edition === "clean") {
  const versions = existsSync(`${dist}/data/versions`) ? readdirSync(`${dist}/data/versions`) : [];
  const deepDiveDirs = [`${dist}/data/models`, ...versions.map((d) => `${dist}/data/versions/${d}/models`)];
  let stripped = 0;
  for (const dir of deepDiveDirs) {
    for (const f of jsonIn(dir)) {
      const doc = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
      if ("onboarding" in doc) { delete doc.onboarding; stripped++; }
      writeFileSync(`${dir}/${f}`, JSON.stringify(doc, null, 2) + "\n");
    }
  }
  // data/litellm.json is the LiteLLM 與安全 page (a model's own LiteLLM facts are in catalog.json and stay). A version
  // published before data/provider-compatibility.json existed has the documented matrix inside litellm.json: it is
  // written out as that file first, so the clean edition's 測試方法 shows it for that version too.
  let carried = 0;
  for (const dir of [`${dist}/data`, ...versions.map((d) => `${dist}/data/versions/${d}`)]) {
    const ll = `${dir}/litellm.json`, pc = `${dir}/provider-compatibility.json`;
    if (existsSync(ll) && !existsSync(pc)) {
      const doc = JSON.parse(readFileSync(ll, "utf8"));
      if (doc.providerCompatibility) {
        writeFileSync(pc, JSON.stringify({ schema: "provider-compatibility/v1", generatedAt: doc.generatedAt, locale: doc.locale, ...doc.providerCompatibility }));
        carried++;
      }
    }
    rmSync(ll, { force: true });
  }
  if (carried) console.log(`clean edition: provider matrix carried out of litellm.json for ${carried} version(s)`);
  rmSync(`${dist}/security-tests.html`, { force: true });
  // security test cases (even redacted, they are case-by-case results): the clean portal shows only the totals
  for (const f of jsonIn(`${dist}/runs/security`)) if (f.endsWith(".cases.json")) rmSync(`${dist}/runs/security/${f}`, { force: true });
  console.log(`clean edition: onboarding removed from ${stripped} deep dive file(s); no data/litellm.json, config/, security-tests.html or security test cases`);
}
