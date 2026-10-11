// Replace data/, runs/ and config/ with the release the research pipeline has live on the data
// location (PORTAL_DATA_BASE_URL, the data-plane stack's DataBaseUrl output). Each file is checked
// against the sha256 in the release record. Without PORTAL_DATA_BASE_URL nothing changes and the
// build uses the data committed to this repo.
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

for (const dir of OWNED) rmSync(`${root}${dir}`, { recursive: true, force: true });
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
