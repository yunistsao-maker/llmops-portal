import { createContext, useContext, useEffect, useState } from "react";
import type {
  CatalogFile, CompatRun, DeepDive, DigestFile, LifecycleFile, LiteLLMFile, OpenModelsFile, PerfRun,
  PlatformInventory, RadarFile, RequirementsFile, Source, SourceRef, SourcesFile,
} from "../../schema/types";

export interface Manifest { generatedAt: string; digests: string[]; models: string[]; compatRuns: string[]; perfRuns: string[]; hasInventory: boolean }

/** One daily version of the site's data: the release that was live at the end of that day (Asia/Taipei). */
export interface VersionInfo { date: string; releaseId: string | null; publishedAt: string | null; latest: boolean; radarAsOf?: string | null }
export interface VersionsFile { schema: string; today: string; versions: VersionInfo[] }

const VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
/** Pages that show the team's own records (測試結果, 發布流程): never versioned, whatever the address says. */
export const UNVERSIONED = new Set(["tests", "release"]);
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

/** Browser-local store (per viewer). Used for gate checklists; wrapped so private windows still work. */
export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } };
  return [v, set];
}
