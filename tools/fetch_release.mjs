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
console.log(`fetched release ${pointer.releaseId} (${pointer.publishedAt}) from ${host}: ${files.size} files`);
