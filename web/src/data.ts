import { useEffect, useState } from "react";
import type { CatalogFile, DeepDive, DigestFile, LifecycleFile, PlatformInventory } from "../../schema/types";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Digest file names are dates; the index is hard-coded until a manifest exists. */
export const DIGESTS = ["2026-09-24"];

export const loaders = {
  catalog: () => getJson<CatalogFile>("data/catalog.json"),
  lifecycle: () => getJson<LifecycleFile>("data/lifecycle.json"),
  digest: (id = DIGESTS[DIGESTS.length - 1]) => getJson<DigestFile>(`data/digests/${id}.json`),
  deepDive: (id: string) => getJson<DeepDive>(`data/models/${id}.json`),
  /** Real inventory (from sync_inventory.py) if present, else the example. */
  inventory: () =>
    getJson<PlatformInventory>("data/internal/platform-inventory.json").catch(() =>
      getJson<PlatformInventory>("data/internal/platform-inventory.example.json"),
    ),
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

export const daysFrom = (iso: string, today = new Date()) =>
  Math.round((new Date(iso + "T00:00:00").getTime() - new Date(today.toDateString()).getTime()) / 86400000);

export const money = (n?: number) => (n === undefined ? "—" : `$${n < 1 ? n.toFixed(2) : n % 1 ? n.toFixed(2) : n}`);
