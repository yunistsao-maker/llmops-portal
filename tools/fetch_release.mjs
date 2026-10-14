// Replace data/, runs/ and config/ with the release the research pipeline has live on the data
// location (PORTAL_DATA_BASE_URL, the data-plane stack's DataBaseUrl output). Each file is checked
// against the sha256 in the release record. Without PORTAL_DATA_BASE_URL nothing changes and the
// build uses the data committed to this repo.
//
// Daily versions: the pointer's `versions` (or, for an older pointer, its history) says which release
// was live at the end of each day (Asia/Taipei). For each of the DAYS - 1 (29) days before today the
// release of that day goes to versions/<date>/ (its data/ only); today is the live release above. A
// release that was live on several days is fetched once. The list of the DAYS (30) days is written to
// .portal-versions.json for tools/build_versions.py and build_site.mjs.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const base = (process.env.PORTAL_DATA_BASE_URL || "").trim();
if (!base) {
  console.log("PORTAL_DATA_BASE_URL not set: using the data in the repo");
  process.exit(0);
}
const root = new URL("..", import.meta.url).pathname;
const at = base.endsWith("/") ? base : base + "/";
const host = new URL(at).host; // never print the path: it carries the access token

async function get(path) {
  const r = await fetch(at + path, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${host}/…/${path}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const pointer = JSON.parse(await get("manifest.json"));
if (pointer.schema !== "portal-manifest/v1" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(pointer.releaseId))
  throw new Error(`unexpected manifest.json from ${host}`);
const release = JSON.parse(await get(`${pointer.basePath}release.json`));

const OWNED = ["data", "runs", "config"]; // replaced wholesale, so files a release removed go away too
// Files the portal reads that the research pipeline's release does not carry yet (its data contract lists them
// once the pipeline supports them). Until then the copy committed to this repo is kept; a release copy always wins.
const REPO_FALLBACK = ["data/open-models.json"];
const { existsSync, readFileSync } = await import("node:fs");
const repoCopies = new Map(REPO_FALLBACK.filter((p) => existsSync(`${root}${p}`)).map((p) => [p, readFileSync(`${root}${p}`)]));
const files = new Map();
for (const [path, { sha256 }] of Object.entries(release.files)) {
  if (path.split("/").includes("..")) throw new Error(`bad path in release: ${path}`);
  if (!OWNED.includes(path.split("/")[0]) && path !== "schema/llmops.schema.json") continue;
  const body = await get(`${pointer.basePath}${path}`);
  if (createHash("sha256").update(body).digest("hex") !== sha256) throw new Error(`sha256 mismatch: ${path}`);
  files.set(path, body);
}
if (!files.has("data/catalog.json")) throw new Error("release has no data/catalog.json");

// ---- daily versions (read before anything is replaced: a failure here leaves the checkout as it was)
const DAYS = 30; // dated versions: today + 29 days (the research pipeline's pointer keeps 30)
const RELEASE_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const taipeiDay = (iso) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10); // UTC+8, no DST
const today = taipeiDay(new Date().toISOString());
let entries = Array.isArray(pointer.versions)
  ? pointer.versions.filter((v) => v && DAY.test(v.date) && RELEASE_ID.test(v.releaseId))
  : (Array.isArray(pointer.history) ? pointer.history : [])
      .filter((h) => h && RELEASE_ID.test(h.releaseId) && !Number.isNaN(Date.parse(h.publishedAt)))
      .map((h) => ({ date: taipeiDay(h.publishedAt), releaseId: h.releaseId, publishedAt: h.publishedAt }));
entries = entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest day first (history: first of a day = last)
const days = [];
for (let i = 0; i < DAYS; i++) {
  const date = taipeiDay(new Date(Date.parse(today + "T12:00:00+08:00") - i * 86400_000).toISOString());
  const live = i === 0 ? { releaseId: pointer.releaseId, publishedAt: pointer.publishedAt ?? null } : entries.find((v) => v.date <= date);
  if (live) days.push({ date, releaseId: live.releaseId, publishedAt: live.publishedAt ?? null });
}
const past = new Map(); // releaseId -> files (data/ only), fetched once however many days show it
for (const d of days.slice(1)) {
  if (past.has(d.releaseId)) continue;
  const base = `releases/${d.releaseId}/`;
  const rec = JSON.parse(await get(`${base}release.json`));
  const got = new Map();
  for (const [path, { sha256 }] of Object.entries(rec.files)) {
    if (path.split("/").includes("..") || path.split("/")[0] !== "data") continue;
    const body = await get(`${base}${path}`);
    if (createHash("sha256").update(body).digest("hex") !== sha256) throw new Error(`sha256 mismatch: ${d.releaseId}/${path}`);
    got.set(path, body);
  }
  past.set(d.releaseId, got);
}

for (const dir of OWNED) rmSync(`${root}${dir}`, { recursive: true, force: true });
rmSync(`${root}versions`, { recursive: true, force: true });
for (const d of days.slice(1)) {
  const got = new Map(past.get(d.releaseId));
  // a day that shows the live release shows what today shows - the repo's copy of a file the release lacks included
  if (d.releaseId === pointer.releaseId) for (const [path, body] of repoCopies) if (!got.has(path)) got.set(path, body);
  for (const [path, body] of got) {
    mkdirSync(dirname(`${root}versions/${d.date}/${path}`), { recursive: true });
    writeFileSync(`${root}versions/${d.date}/${path}`, body);
  }
}
writeFileSync(`${root}.portal-versions.json`, JSON.stringify({ today, days }, null, 2) + "\n");
for (const [path, body] of files) {
  mkdirSync(dirname(`${root}${path}`), { recursive: true });
  writeFileSync(`${root}${path}`, body);
}
for (const [path, body] of repoCopies) {
  if (files.has(path)) continue;
  mkdirSync(dirname(`${root}${path}`), { recursive: true });
  writeFileSync(`${root}${path}`, body);
  console.log(`kept the repo copy of ${path}: the release does not carry it`);
}
// what this build shows: build_site.mjs copies it into data/manifest.json (release), so a post-deploy check can compare
// it with the pointer on the data location. No URL here: the data location's path carries the access token.
writeFileSync(`${root}.portal-release.json`, JSON.stringify({ releaseId: pointer.releaseId, publishedAt: pointer.publishedAt ?? null, fetchedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`fetched release ${pointer.releaseId} (${pointer.publishedAt}) from ${host}: ${files.size} files`);
console.log(`daily versions: ${days.map((d) => `${d.date}=${d.releaseId}`).join(", ")}`);
