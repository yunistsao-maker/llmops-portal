import { createContext, useContext, useEffect, useState } from "react";
import type {
  BenchmarkResult, CatalogFile, CompatRun, DeepDive, DigestFile, LifecycleFile, LiteLLMFile, Model, OpenModelsFile, PerfRun,
  PlatformInventory, RadarFile, RequirementsFile, SecurityRunCases, SecurityRunSummary, Source, SourceRef, SourcesFile,
} from "../../schema/types";

export interface Manifest { generatedAt: string; digests: string[]; models: string[]; compatRuns: string[]; perfRuns: string[]; securityRuns?: string[]; securityCases?: string[]; hasInventory: boolean }

/**
 * Which portal this build is (VITE_EDITION, set by `npm run build:clean`): "full" for the platform team, "clean" for
 * everyone who needs the latest LLM information - without 測試結果, 發布流程, LiteLLM 與安全, 上手指南, the model
 * page's Onboarding tab and the AI security test demo.
 */
export const EDITION: "full" | "clean" = import.meta.env.VITE_EDITION === "clean" ? "clean" : "full";
/** Pages the clean edition does not have (their routes fall back to the Release Radar). */
export const CLEAN_HIDDEN = new Set(["tests", "release", "gateway", "onboarding"]);
export const hasPage = (section: string) => EDITION === "full" || !CLEAN_HIDDEN.has(section);

/** One daily version of the site's data: the release that was live at the end of that day (Asia/Taipei). */
export interface VersionInfo { date: string; releaseId: string | null; publishedAt: string | null; latest: boolean; radarAsOf?: string | null }
export interface VersionsFile { schema: string; today: string; versions: VersionInfo[] }

const VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
/** Pages that show the team's own records (測試結果, 發布流程): never versioned, whatever the address says. */
export const UNVERSIONED = new Set(["tests", "release"]);
/** How many dated versions a build keeps (today + 29 days): tools/fetch_release.mjs DAYS. */
export const VERSION_DAYS = 30;
/** The daily version named in the address (#/models?v=2026-10-10), kept while moving between pages. */
export function addressVersion(): string | null {
  const v = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("v");
  return v && VERSION.test(v) ? v : null;
}
/** The version THIS page shows: the address's, except on an unversioned page; null = the latest (data/). */
export function selectedVersion(): string | null {
  const section = window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/")[0];
  return UNVERSIONED.has(section) ? null : addressVersion();
}
/** A link inside the portal that keeps the selected daily version. */
export const linkTo = (path: string) => { const v = addressVersion(); return "#/" + path + (v ? `?v=${v}` : ""); };
/** Where the research data of the selected version lives. Test results (runs/) are not versioned. */
const dataBase = () => { const v = selectedVersion(); return v ? `data/versions/${v}/` : "data/"; };

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
const cache = new Map<string, Promise<unknown>>();
function cached<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, getJson<T>(path).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path) as Promise<T>;
}

export const loaders = {
  /** The 7 daily versions (tools/build_site.mjs). Optional: a build from the repo's data has only today. */
  versions: () => cached<VersionsFile>("data/versions.json"),
  manifest: () => cached<Manifest>(`${dataBase()}manifest.json`),
  catalog: () => cached<CatalogFile>(`${dataBase()}catalog.json`),
  lifecycle: () => cached<LifecycleFile>(`${dataBase()}lifecycle.json`),
  litellm: () => cached<LiteLLMFile>(`${dataBase()}litellm.json`),
  requirements: () => cached<RequirementsFile>(`${dataBase()}requirements.json`),
  /** Optional file: the open-weight model radar. Rejects when the file is not there; pages show an empty state. */
  openModels: () => cached<OpenModelsFile>(`${dataBase()}open-models.json`),
  /** Optional file: the merged Release Radar (tools/build_radar.py). Without it the Radar page falls back to the newest digest. */
  radar: () => cached<RadarFile>(`${dataBase()}radar.json`),
  sources: () => cached<SourcesFile>(`${dataBase()}sources.json`),
  digest: (id: string) => cached<DigestFile>(`${dataBase()}digests/${id}.json`),
  deepDive: (id: string) => cached<DeepDive>(`${dataBase()}models/${id}.json`),
  inventory: async () => {
    const m = await loaders.manifest();
    return cached<PlatformInventory>(m.hasInventory ? `${dataBase()}internal/platform-inventory.json` : "data/internal/platform-inventory.example.json");
  },
  compatRuns: async () => { const m = await loaders.manifest(); return Promise.all(m.compatRuns.map((f) => cached<CompatRun>(`runs/compat/${f}`))); },
  perfRuns: async () => { const m = await loaders.manifest(); return Promise.all(m.perfRuns.map((f) => cached<PerfRun>(`runs/perf/${f}`))); },
  /** runs/security: aggregate results of tools/sec_suite.py (no prompt or response text). */
  securityRuns: async () => { const m = await loaders.manifest(); return Promise.all((m.securityRuns ?? []).map((f) => cached<SecurityRunSummary>(`runs/security/${f}`))); },
  /** The redacted cases of one security run - null when this build has none (always so in the clean edition). */
  securityCases: async (runId: string) => {
    const m = await loaders.manifest();
    const f = `${runId}.cases.json`;
    return EDITION === "full" && (m.securityCases ?? []).includes(f) ? cached<SecurityRunCases>(`runs/security/${f}`) : null;
  },
};

export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    set({});
    load().then((data) => live && set({ data }), (e) => live && set({ error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Sources are loaded once at the top and shared so any page can render SourceRefs as links. */
export const SourcesCtx = createContext<Map<string, Source>>(new Map());
export const useSources = () => useContext(SourcesCtx);
export type { SourceRef };

/** "Today" as the page sees it: the selected version's day, so a past version counts days as they were then. */
export const viewDate = () => { const v = selectedVersion(); return v ? new Date(v + "T00:00:00") : new Date(); };
export const daysFrom = (iso: string, today = viewDate()) =>
  Math.round((new Date(iso + "T00:00:00").getTime() - new Date(today.toDateString()).getTime()) / 86400000);
export const money = (n?: number) => (n === undefined ? "—" : `$${Number.isInteger(n) ? n : n < 0.1 ? n.toFixed(3).replace(/0$/, "") : n.toFixed(2)}`);
export const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d }));

/** Artificial Analysis Intelligence Index scores compare only within one index version (catalog, compare). */
export const isAA = (b: BenchmarkResult) => b.name.startsWith("Artificial");
/** "v4.3.2" -> [4, 3, 2]; null for a version that is not a dotted number (e.g. a note about an older index). */
export const versionKey = (v?: string) => { const m = /^v?(\d+(?:\.\d+)*)$/.exec((v ?? "").trim()); return m ? m[1].split(".").map(Number) : null; };
const newer = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return false; };

/** The newest Artificial Analysis index version any of these models has a score for. */
export function newestAAVersion(models: Model[]): string | undefined {
  let best: { v: string; k: number[] } | undefined;
  for (const b of models.flatMap((m) => m.benchmarks.filter(isAA))) {
    const k = versionKey(b.version);
    if (k && b.version && (!best || newer(k, best.k))) best = { v: b.version, k };
  }
  return best?.v;
}

/** This model's AA score for `version` (the newest reading when there are several), and its newest score in another version. */
export function aaScore(m: Model, version?: string): { score?: BenchmarkResult; other?: BenchmarkResult } {
  const mine = m.benchmarks.filter(isAA);
  const score = mine.filter((x) => x.version === version).sort((x, y) => y.date.localeCompare(x.date))[0];
  const other = score ? undefined : mine.filter((x) => versionKey(x.version)).sort((x, y) => y.date.localeCompare(x.date))[0];
  return { score, other };
}

/** Browser-local store (per viewer). Used for gate checklists; wrapped so private windows still work. */
export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } };
  return [v, set];
}
