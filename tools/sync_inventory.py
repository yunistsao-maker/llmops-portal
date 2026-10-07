#!/usr/bin/env python3
"""Build data/internal/platform-inventory.json: what is deployed on YOUR gateway, joined with CSP lifecycle data.

Source of truth for "what's on our platform" is LiteLLM itself (GET /model/info), not a hand-kept list.
Each deployment is matched to data/catalog.json offerings and data/lifecycle.json events, and gets a risk flag:
  retired   the next/last retirement date has passed — calls are failing or about to
  act-now   a lifecycle event is <= 30 days away
  watch     a lifecycle event is <= 90 days away
  ok        matched, nothing within 90 days
  unknown   no match — set model_info.catalog_id / provider_model_id (and model_version for Azure) in your LiteLLM config

Matching is per channel (Bedrock vs Foundry vs Agent Platform vs vendor API), because the same model retires on
different dates per channel. Azure deployment names are arbitrary, so give Azure deployments
model_info.base_model (e.g. "azure/gpt-4o") and model_info.model_version (e.g. "2024-11-20").

Examples:
  python3 tools/sync_inventory.py --gateway https://llm-gateway.example.internal --api-key-env LITELLM_MASTER_KEY
  python3 tools/sync_inventory.py --from-json model_info_dump.json      # offline, from a saved /model/info response
  python3 tools/sync_inventory.py --from-config litellm_config.yaml     # needs PyYAML

Only litellm_params.model is kept; keys, api_base and other secrets are never written.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

PROVIDER_PREFIXES = [
    "bedrock/converse/", "bedrock/invoke/", "bedrock_mantle/", "bedrock/", "vertex_ai/", "azure_ai/", "azure/",
    "anthropic/", "openai/", "gemini/",
]
GEO_PREFIX = re.compile(r"^(us|eu|apac|jp|au|ca|us-gov|global)\.")
EVENT_ORDER = {"retirement": 0, "extended-access": 1, "deprecation": 2, "legacy": 3, "eol-no-sooner-than": 4, "price-change": 5}


def normalize(model: str) -> str:
    m = model.strip().lower()
    for p in PROVIDER_PREFIXES:
        if m.startswith(p):
            m = m[len(p):]
            break
    m = GEO_PREFIX.sub("", m)
    return m.split("@", 1)[0]


SERVICE_BY_PREFIX = [
    ("bedrock", "bedrock"), ("vertex_ai/", "agent-platform"), ("azure", "foundry"),
    ("anthropic/", "anthropic-api"), ("openai/", "openai-api"), ("gemini/", "gemini-api"),
]


def service_of(model: str) -> str | None:
    m = model.strip().lower()
    for prefix, service in SERVICE_BY_PREFIX:
        if m.startswith(prefix):
            return service
    return None


def split_ids(provider_model_id: str) -> list[str]:
    """'gpt-4o (2024-08-06, 2024-11-20), gpt-4o-mini' -> ['gpt-4o', 'gpt-4o-mini']"""
    no_paren = re.sub(r"\s*[（(][^)）]*[)）]", "", provider_model_id)
    return [normalize(p) for p in re.split(r"\s*,\s*|\s+/\s+", no_paren) if p.strip()]


def load_deployments(args) -> tuple[list[dict], str | None]:
    if args.from_json:
        data = json.load(open(args.from_json, encoding="utf-8"))
        return data.get("data", data), None
    if args.from_config:
        try:
            import yaml  # type: ignore
        except ImportError:
            sys.exit("pip install pyyaml (needed for --from-config)")
        cfg = yaml.safe_load(open(args.from_config, encoding="utf-8"))
        return cfg.get("model_list", []), None
    import httpx  # imported lazily so offline modes need no deps

    key = os.environ.get(args.api_key_env, "")
    base = args.gateway.rstrip("/")
    headers = {"Authorization": f"Bearer {key}"}
    r = httpx.get(f"{base}/model/info", headers=headers, timeout=30)
    r.raise_for_status()
    version = None
    try:
        h = httpx.get(f"{base}/health/readiness", timeout=10)
        version = (h.json() or {}).get("litellm_version")
    except Exception:
        pass
    return r.json().get("data", []), version


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--gateway", help="LiteLLM base URL (without /v1)")
    src.add_argument("--from-json", help="Saved /model/info response")
    src.add_argument("--from-config", help="LiteLLM config.yaml")
    ap.add_argument("--api-key-env", default="LITELLM_MASTER_KEY")
    ap.add_argument("--catalog", default=os.path.join(ROOT, "data/catalog.json"))
    ap.add_argument("--lifecycle", default=os.path.join(ROOT, "data/lifecycle.json"))
    ap.add_argument("--today", help="Override today's date (YYYY-MM-DD) for testing")
    ap.add_argument("--out", default=os.path.join(ROOT, "data/internal/platform-inventory.json"))
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    catalog = json.load(open(args.catalog, encoding="utf-8"))
    lifecycle = json.load(open(args.lifecycle, encoding="utf-8"))

    # index: (service, normalized provider id) -> (catalog model id, offering id)
    offering_index: dict[tuple[str, str], tuple[str, str]] = {}
    for m in catalog["models"]:
        for o in m["offerings"]:
            ids = split_ids(o["providerModelId"]) + [normalize(t["id"]) for t in o.get("inferenceTargets", [])]
            if o.get("litellmModel"):
                ids.append(normalize(o["litellmModel"]))
            for i in ids:
                offering_index.setdefault((o["service"], i), (m["id"], o["id"]))
    # index: (service, normalized provider id) -> lifecycle events (channel-specific: same model, different clocks)
    event_index: dict[tuple[str, str], list[dict]] = {}
    for e in lifecycle["events"]:
        for i in split_ids(e["providerModelId"]):
            event_index.setdefault((e["service"], i), []).append(e)

    deployments, version = load_deployments(args)
    out = []
    for d in deployments:
        lp = d.get("litellm_params") or {}
        mi = d.get("model_info") or {}
        raw_model = lp.get("model", "")
        name = d.get("model_name", "")
        service = mi.get("service") or service_of(raw_model) or service_of(mi.get("base_model") or "")
        keys = [normalize(raw_model)]
        for extra in (mi.get("provider_model_id"), mi.get("base_model")):
            if extra:
                keys.insert(0, normalize(extra))
        catalog_id = mi.get("catalog_id")
        matched = None
        events: list[dict] = []
        for k in keys:
            if (service, k) in offering_index:
                catalog_id = catalog_id or offering_index[(service, k)][0]
                matched = matched or k
            if (service, k) in event_index:
                matched = matched or k
                events += event_index[(service, k)]
        # Version-specific events (Azure): keep only the deployment's version when model_info.model_version is set.
        version = str(mi.get("model_version") or "")
        if version:
            events = [e for e in events if not e.get("version") or e["version"] == version]
        events = list({e["id"]: e for e in events}.values())
        # prefer the earliest upcoming actionable event; else the latest past retirement
        upcoming = sorted((e for e in events if date.fromisoformat(e["date"]) >= today), key=lambda e: (e["date"], EVENT_ORDER.get(e["event"], 9)))
        past_ret = sorted((e for e in events if e["event"] == "retirement" and date.fromisoformat(e["date"]) < today), key=lambda e: e["date"])
        item = {"modelName": name, "litellmModel": raw_model}
        if catalog_id:
            item["catalogModelId"] = catalog_id
        if matched:
            item["matchedProviderModelId"] = matched
        risk = "unknown" if not (catalog_id or events) else "ok"
        if past_ret and not any(e["event"] == "retirement" for e in upcoming):
            e = past_ret[-1]
            item["lifecycle"] = {"status": "retired", "nextEvent": "retirement", "nextEventDate": e["date"], **({"replacement": e["replacement"]} if e.get("replacement") else {})}
            item["daysToNextEvent"] = (date.fromisoformat(e["date"]) - today).days
            risk = "retired"
        elif upcoming:
            actionable = [e for e in upcoming if e["event"] in ("retirement", "extended-access", "deprecation", "legacy", "price-change")]
            e = actionable[0] if actionable else upcoming[0]
            days = (date.fromisoformat(e["date"]) - today).days
            item["lifecycle"] = {"nextEvent": e["event"], "nextEventDate": e["date"], **({"replacement": e["replacement"]} if e.get("replacement") else {})}
            item["daysToNextEvent"] = days
            if e["event"] != "eol-no-sooner-than":
                risk = "act-now" if days <= 30 else ("watch" if days <= 90 else "ok")
        item["risk"] = risk
        out.append(item)

    inv = {
        "schema": "platform-inventory/v1",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "gateway": args.gateway or (args.from_json or args.from_config),
        "deployments": out,
    }
    if version:
        inv["litellmVersion"] = version
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(inv, f, ensure_ascii=False, indent=2)
        f.write("\n")
    order = {"retired": 0, "act-now": 1, "watch": 2, "unknown": 3, "ok": 4}
    for it in sorted(out, key=lambda x: (order[x["risk"]], x.get("daysToNextEvent", 9999))):
        lc = it.get("lifecycle", {})
        print(f"{it['risk']:<8} {it['modelName']:<32} {lc.get('nextEvent', ''):<18} {lc.get('nextEventDate', ''):<11} {it.get('daysToNextEvent', ''):>5}  {lc.get('replacement', '')}")
    print(f"wrote {os.path.relpath(args.out, os.getcwd())} ({len(out)} deployments)")


if __name__ == "__main__":
    main()
