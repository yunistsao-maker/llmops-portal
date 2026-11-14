#!/usr/bin/env python3
"""Build frontend/data/ui.json — the read-only view model for the static LLMOps Portal UI (llm-ops-frontend).

The new UI never computes from the raw research files in the browser. This script reads the data contract
(schema/llmops.schema.json files: catalog, lifecycle, radar, digests, deep dives, open models, requirements,
security runs, sources) plus the small hand-written frontend/ui-curation.json, and writes one JSON document
that matches schema/ui.schema.json ("llmops-ui/v1").

  python3 tools/build_ui_data.py            # write frontend/data/ui.json
  python3 tools/build_ui_data.py --check    # exit 1 if the committed file is stale

Standard library only (runs in the Amplify build image without pip).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, OrderedDict
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "frontend/data/ui.json")

SERVICE_LABEL = {
    "bedrock": "AWS Bedrock", "foundry": "Azure Foundry", "agent-platform": "GCP Agent Platform",
    "anthropic-api": "Anthropic API", "openai-api": "OpenAI API", "gemini-api": "Gemini API",
}
CLOUD_COLUMNS = [("aws", "bedrock", "AWS Bedrock"), ("azure", "foundry", "Azure Foundry"), ("gcp", "agent-platform", "GCP Agent Platform")]
STATUS_LABEL = {
    "ga": "GA", "preview": "Preview", "private-preview": "Private preview", "limited-access": "Limited access",
    "announced": "已宣布", "restricted": "受限", "unknown": "未確認", "legacy": "Legacy", "deprecated": "Deprecated", "retired": "已退役", "not-offered": "未上架",
}
TIERS = [
    ("frontier", "旗艦", "最難的推理與長時程代理"),
    ("balanced", "主力", "日常主力：品質與成本平衡"),
    ("efficient", "輕量", "高量、低延遲：摘要、擷取、分類、路由"),
]
VENDOR_LABEL = {
    "anthropic": "Anthropic", "openai": "OpenAI", "google": "Google", "xai": "xAI", "meta": "Meta", "mistral": "Mistral AI",
    "deepseek": "DeepSeek", "moonshot": "Moonshot AI", "amazon": "Amazon", "microsoft": "Microsoft", "cohere": "Cohere",
    "ai21": "AI21 Labs", "twelvelabs": "TwelveLabs", "other": "其他",
}
SECTIONS = OrderedDict([
    ("newModels", "上架"), ("pricingChanges", "價格"), ("lifecycleChanges", "退役"),
    ("litellm", "Gateway"), ("security", "資安"), ("regulatory", "法規"),
])
CLOUD_WHERE = {"vendor-direct": "原廠 API", "aws": "AWS", "azure": "Azure", "gcp": "GCP"}
WATCH_STATUS = {"announced": "已宣布", "rumoured": "傳聞", "limited-preview": "限量預覽", "coming-soon": "即將推出"}
LICENSE = {"mit": "MIT", "apache-2.0": "Apache 2.0", "": "授權未確認"}
GATES = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"]
RESIDENCY_SCOPES = ("geo", "data-zone", "multi-region", "in-region", "regional", "non-global")


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def d(s):
    return date.fromisoformat(s[:10])


def money(v):
    if v is None:
        return None
    if abs(v - round(v)) < 1e-9 and v >= 1:
        return f"${int(round(v))}"
    return f"${v:.2f}"


def price_text(p):
    return f"{money(p['input'])} / {money(p['output'])}" if p else None


def short_date(s):
    return s[5:10] if s else None


def build():
    catalog = load("data/catalog.json")
    lifecycle = load("data/lifecycle.json")
    radar = load("data/radar.json")
    sources = {s["id"]: s for s in load("data/sources.json")["sources"]}
    open_models = load("data/open-models.json")
    requirements = load("data/requirements.json")
    curation = load("frontend/ui-curation.json")
    digests = sorted(glob.glob(os.path.join(ROOT, "data/digests/*.json")))
    digest = load(os.path.relpath(digests[-1], ROOT))
    deep = {os.path.basename(p)[:-5]: load(os.path.relpath(p, ROOT)) for p in glob.glob(os.path.join(ROOT, "data/models/*.json"))}
    sec_runs = sorted(p for p in glob.glob(os.path.join(ROOT, "runs/security/*.json")) if not p.endswith(".cases.json"))
    sec = load(os.path.relpath(sec_runs[-1], ROOT)) if sec_runs else None
    as_of = radar["asOf"]
    today = d(as_of)
    used_sources: set[str] = set()

    def refs(lst):
        out = []
        for r in lst or []:
            s = sources.get(r["id"])
            if s:
                used_sources.add(s["id"])
                out.append(s["id"])
        return out

    models_by_id = {m["id"]: m for m in catalog["models"]}

    # ------------------------------------------------------------------ security run (G6)
    security = None
    sec_by_model: dict[str, dict] = {}
    if sec:
        label_to_id = {}
        for t in sec["targets"]:
            mid = t.get("modelId") or t.get("model")
            if mid in models_by_id:
                label_to_id[t["label"]] = mid
        per = {}
        for it in sec["items"]:
            for label, res in it["results"].items():
                if label not in label_to_id:
                    continue
                p = per.setdefault(label, {"pass": 0, "fail": 0, "review": 0, "info": 0, "fails": [], "reviews": []})
                v = res.get("verdict")
                if v in p:
                    p[v] += 1
                if v == "fail":
                    p["fails"].append({"id": it["id"], "title": it["title"], "rate": res.get("rate"), "rule": it.get("ruleText", "")})
                if v == "review":
                    p["reviews"].append({"id": it["id"], "title": it["title"]})
        smodels = []
        for label, p in per.items():
            mid = label_to_id[label]
            row = {"modelId": mid, "name": models_by_id[mid]["name"], **{k: p[k] for k in ("pass", "fail", "review", "info")},
                   "fails": p["fails"], "reviews": p["reviews"]}
            smodels.append(row)
            sec_by_model[mid] = row
        common = None
        if smodels:
            common = set(f["id"] for f in smodels[0]["fails"])
            for r in smodels[1:]:
                common &= set(f["id"] for f in r["fails"])
        titles = {it["id"]: it["title"] for it in sec["items"]}
        security = {
            "runId": sec["runId"], "date": sec["startedAt"][:10], "caseCount": sec.get("caseCount"),
            "litellmVersion": sec.get("config", {}).get("litellmVersion"), "judge": sec.get("judge", {}).get("label"),
            "models": smodels,
            "commonFails": [{"id": i, "title": titles[i]} for i in sorted(common or [])],
            "untested": [m["name"] for m in catalog["models"] if m["id"] not in sec_by_model],
        }

    compat_runs = glob.glob(os.path.join(ROOT, "runs/compat/*.json"))
    perf_runs = glob.glob(os.path.join(ROOT, "runs/perf/*.json"))

    # ------------------------------------------------------------------ lifecycle helpers
    events = lifecycle["events"]

    def upcoming(e):
        return d(e["date"]) >= today

    # ------------------------------------------------------------------ models
    overrides = curation.get("availabilityOverrides", {})
    ui_models = []
    for m in catalog["models"]:
        offs = {o["service"]: o for o in m["offerings"]}
        clouds = {}
        prices = []
        for cloud, service, label in CLOUD_COLUMNS + [("vendor-direct", s, SERVICE_LABEL[s]) for s in ("anthropic-api", "openai-api", "gemini-api")]:
            o = offs.get(service)
            key = service
            if not o:
                ov = overrides.get(m["id"], {}).get(service)
                if ov:
                    clouds[key] = {"cloud": cloud, "service": service, "serviceLabel": label, "status": ov["status"],
                                   "statusLabel": STATUS_LABEL.get(ov["status"], ov["status"]), "since": ov.get("since"),
                                   "note": ov.get("note"), "sources": refs(ov.get("sources")), "fromCatalog": False}
                elif cloud != "vendor-direct":
                    clouds[key] = {"cloud": cloud, "service": service, "serviceLabel": label, "status": "not-offered",
                                   "statusLabel": "未上架", "fromCatalog": True}
                continue
            pr = o.get("pricing") or []
            glob_p = next((p for p in pr if p["scope"].startswith("global") and "ultrafast" not in p["scope"]), None) or \
                next((p for p in pr if p["scope"].startswith("standard")), None) or (pr[0] if pr else None)
            res_p = next((p for p in pr if p is not glob_p and any(p["scope"].startswith(s) for s in RESIDENCY_SCOPES)), None)
            if glob_p:
                prices.append((glob_p["input"], glob_p["output"], service))
            taipei = next((a for a in o.get("apacAvailability", []) if a["region"] in ("ap-east-2", "asia-east1", "taiwannorth")), None)
            if service == "bedrock":
                tw = "global-cris" if taipei and "global" in taipei.get("scopes", []) else "unavailable"
            else:
                tw = "unavailable"
            tw_label = {"global-cris": "台北可用（Global CRIS）", "unavailable": "台北不可用"}[tw]
            apac = [{"region": a["region"], "label": a.get("label", a["region"]), "scopes": a.get("scopes", []), "note": a.get("note")}
                    for a in o.get("apacAvailability", [])]
            feats = {f["feature"]: f for f in o.get("features", [])}
            so = feats.get("structured-outputs")
            lc = [e for e in events if e["service"] == service and upcoming(e) and (
                o["providerModelId"] in e["providerModelId"] or m["vendorModelId"] in e["providerModelId"])]
            lc.sort(key=lambda e: e["date"])
            dp = o.get("dataProcessing", {})
            clouds[key] = {
                "cloud": cloud, "service": service, "serviceLabel": label, "status": o["status"],
                "statusLabel": STATUS_LABEL.get(o["status"], o["status"]), "since": o.get("availableSince"),
                "priceGlobal": {"input": glob_p["input"], "output": glob_p["output"], "cacheRead": glob_p.get("cacheRead"), "scope": glob_p["scope"]} if glob_p else None,
                "priceResidency": {"input": res_p["input"], "output": res_p["output"], "scope": res_p["scope"]} if res_p else None,
                "taiwan": tw, "taiwanLabel": tw_label,
                "apac": apac,
                "residency": dp.get("residencyOptions", []),
                "zdr": dp.get("zdr"),
                "structuredOutputs": {"status": so["status"], "note": so.get("note")} if so else None,
                "litellmModel": o.get("litellmModel"),
                "earliestEvent": {"date": lc[0]["date"], "event": lc[0]["event"]} if lc else (
                    {"date": o["lifecycle"]["eolNoSoonerThan"], "event": "eol-no-sooner-than"} if o.get("lifecycle", {}).get("eolNoSoonerThan") else None),
                "regionNotes": o.get("regionNotes", [])[:3],
                "sources": refs(o.get("sources")),
                "fromCatalog": True,
            }
        prices.sort()
        price_min = {"input": prices[0][0], "output": prices[0][1], "service": prices[0][2]} if prices else None

        bms = [b for b in m.get("benchmarks", []) if b["name"].startswith("Artificial Analysis Intelligence Index")]
        v5 = next((b for b in bms if b.get("version") == "v5"), None)
        prev = next((b for b in bms if b.get("version") != "v5"), None)
        aa = {"score": v5["score"], "version": "v5", "variant": v5.get("variant"), "date": v5["date"]} if v5 else None
        aa_prev = {"score": prev["score"], "version": prev.get("version")} if prev else None
        if v5:
            refs(v5["sources"])
        perf = next(iter(m.get("performanceReference") or []), None)

        dd = deep.get(m["id"])
        # gate states (derived; see frontend README)
        g = {k: "todo" for k in GATES}
        g["G0"] = "ok"
        g["G1"] = "ok" if dd else "doing"
        if dd:
            g["G2"] = "doing"
        srow = sec_by_model.get(m["id"])
        if srow:
            g["G6"] = "block" if srow["fail"] else ("doing" if srow["review"] else "ok")
        if price_min:
            g["G7"] = "doing"
        if compat_runs:
            g["G3"] = "doing"
        if perf_runs:
            g["G4"] = "doing"

        behaviour = []
        if dd:
            for b in dd.get("breakingChanges", []):
                behaviour.append({"severity": b["severity"], "title": b["title"], "detail": b["detail"], "migration": b["migration"]})

        name_l = m["name"].lower()
        replaces = []
        for e in events:
            rep = (e.get("replacement") or "").lower()
            if upcoming(e) and rep and (m["vendorModelId"] in rep or name_l in rep):
                replaces.append({"date": e["date"], "what": e["modelName"], "where": SERVICE_LABEL.get(e["service"], e["service"]), "event": e["event"]})
        replaces.sort(key=lambda x: x["date"])

        ui_models.append({
            "id": m["id"], "name": m["name"], "vendor": m["vendor"], "vendorLabel": VENDOR_LABEL.get(m["vendor"], m["vendor"]),
            "tier": m["tier"], "tierLabel": dict((t[0], t[1]) for t in TIERS)[m["tier"]],
            "releaseDate": m.get("releaseDate"), "platformStatus": m["platformStatus"],
            "platformStatusLabel": {"evaluating": "評估中", "watch": "觀察中", "ga": "已上線", "beta": "Beta"}.get(m["platformStatus"], m["platformStatus"]),
            "vendorModelId": m["vendorModelId"], "modelCardUrl": m.get("modelCardUrl"),
            "summary": m.get("summary"), "tldr": dd["tldr"] if dd else None,
            "contextWindow": m.get("contextWindow"), "maxOutputTokens": m.get("maxOutputTokens"),
            "aa": aa, "aaPrevious": aa_prev,
            "perf": {"outputTokensPerSec": perf.get("outputTokensPerSec"), "ttftSec": perf.get("ttftSec"), "date": perf.get("date"),
                     "provider": perf.get("provider"), "variant": perf.get("variant")} if perf else None,
            "priceMin": price_min,
            "strengths": m.get("strengths", [])[:4], "weaknesses": m.get("weaknesses", [])[:4],
            "bestFor": m.get("bestFor", []), "avoidFor": m.get("avoidFor", []),
            "clouds": clouds,
            "security": srow,
            "gates": [{"gate": k, "state": g[k]} for k in GATES],
            "behaviourChanges": behaviour,
            "replaces": replaces[:8],
            "hasDeepDive": bool(dd),
            "sources": refs(m.get("sources"))[:12],
        })

    # related news per model (radar cards, all sections)
    def card_list():
        for sec_key, label in SECTIONS.items():
            for c in radar.get(sec_key, []):
                yield sec_key, label, c
    for um in ui_models:
        keys = [um["id"], um["vendorModelId"], um["name"].lower()]
        rel = []
        for sk, label, c in card_list():
            hay = ((c.get("topic") or "") + " " + c["title"]).lower()
            if any(k in hay for k in keys):
                rel.append({"date": c.get("date") or c.get("lastSeen"), "section": sk, "sectionLabel": label, "title": c["title"]})
        rel.sort(key=lambda x: x["date"] or "", reverse=True)
        um["related"] = rel[:6]

    # ------------------------------------------------------------------ tiers & price bands
    tiers = []
    for tid, name, hint in TIERS:
        ms = [u for u in ui_models if u["tier"] == tid]
        ms.sort(key=lambda u: -(u["aa"]["score"] if u["aa"] else (u["aaPrevious"]["score"] - 100 if u["aaPrevious"] else -200)))
        tiers.append({"id": tid, "name": name, "hint": hint, "modelIds": [u["id"] for u in ms]})
    bands_def = [("output ≤ $5", 0, 5), ("output $6–$12", 5.0001, 12), ("output $15–$30", 12.0001, 30), ("output > $30", 30.0001, 1e9)]
    bands = []
    for label, lo, hi in bands_def:
        ms = [u for u in ui_models if u["priceMin"] and lo <= u["priceMin"]["output"] <= hi]
        ms.sort(key=lambda u: -(u["aa"]["score"] if u["aa"] else 0))
        if ms:
            bands.append({"label": label, "models": [{"id": u["id"], "name": u["name"], "aa": u["aa"]["score"] if u["aa"] else None,
                                                      "price": price_text(u["priceMin"])} for u in ms]})

    # ------------------------------------------------------------------ news (current digest)
    news_items = []
    for sk, label in SECTIONS.items():
        for it in digest.get(sk, []):
            if it.get("check"):
                continue
            where = "Gateway" if (sk == "litellm" or "litellm" in (it.get("topic") or "")) else "、".join(CLOUD_WHERE.get(c, c) for c in it.get("clouds", [])) or VENDOR_LABEL.get(it.get("vendor"), "")
            news_items.append({"date": it.get("date"), "section": sk, "sectionLabel": label, "title": it["title"], "detail": it["detail"],
                               "impact": it["impact"], "where": where, "vendor": it.get("vendor"), "topic": it.get("topic"),
                               "sources": refs(it.get("sources"))})
    impact_rank = {"high": 0, "medium": 1, "low": 2}
    news_items.sort(key=lambda x: (x["date"] or ""), reverse=True)
    total_cards = sum(len(radar.get(k, [])) for k in SECTIONS)
    checks = [{"date": c.get("date"), "section": c.get("section"), "title": c["title"], "detail": c.get("detail", "")} for c in radar.get("checks", [])]

    # ------------------------------------------------------------------ retirements (30 days)
    window = [e for e in events if e["event"] in ("retirement", "deprecation", "extended-access", "legacy") and 0 <= (d(e["date"]) - today).days <= 30]
    groups: "OrderedDict[tuple, list]" = OrderedDict()
    for e in sorted(window, key=lambda e: (e["date"], e["service"])):
        groups.setdefault((e["date"], e["service"]), []).append(e)
    retire_rows = []
    for (dt, svc), evs in groups.items():
        names = [e["modelName"] for e in evs]
        what = "、".join(names[:3]) + (f" 等 {len(names)} 個" if len(names) > 3 else "")
        reps = list(OrderedDict.fromkeys(e["replacement"] for e in evs if e.get("replacement")))
        retire_rows.append({"date": dt, "days": (d(dt) - today).days, "what": what, "count": len(evs),
                            "where": SERVICE_LABEL.get(svc, svc), "replacement": " / ".join(reps) if reps else None,
                            "service": svc, "ids": [e["id"] for e in evs]})
    nst = [{"date": e["date"], "what": e["modelName"], "where": SERVICE_LABEL.get(e["service"], e["service"])}
           for e in sorted(events, key=lambda e: e["date"]) if e["event"] == "eol-no-sooner-than" and 0 <= (d(e["date"]) - today).days <= 30]
    later = []
    for e in sorted(events, key=lambda e: e["date"]):
        if e["event"] == "retirement" and 30 < (d(e["date"]) - today).days <= 60:
            later.append({"date": e["date"], "what": e["modelName"], "where": SERVICE_LABEL.get(e["service"], e["service"]), "replacement": e.get("replacement")})
    price_changes = [{"date": e["date"], "what": e["modelName"], "where": SERVICE_LABEL.get(e["service"], e["service"])}
                     for e in sorted(events, key=lambda e: e["date"]) if e["event"] == "price-change" and 0 <= (d(e["date"]) - today).days <= 60]

    # ------------------------------------------------------------------ action items → todos, brief
    pr_rank = {"P0": 0, "P1": 1, "P2": 2}
    todos = []
    for a in radar["actionItems"]:
        due = a.get("due")
        days = (d(due) - today).days if due else None
        todos.append({"priority": a["priority"], "due": due, "days": days, "overdue": False, "text": a["action"], "topic": a.get("topic"),
                      "isNew": a.get("isNew", False), "relatedModelIds": [x for x in a.get("relatedModelIds", []) if x in models_by_id]})
    for a in radar.get("retired", []):
        if a.get("reason") == "expired" and a.get("due"):
            days = (d(a["due"]) - today).days
            todos.append({"priority": a["priority"], "due": a["due"], "days": days, "overdue": True, "text": a["action"], "topic": a.get("topic"),
                          "isNew": False, "relatedModelIds": []})
    todos.sort(key=lambda t: (not t["overdue"], pr_rank[t["priority"]], t["due"] or "9999"))
    p01_open = sum(1 for t in todos if not t["overdue"] and t["priority"] in ("P0", "P1"))
    overdue = sum(1 for t in todos if t["overdue"])

    cur_brief = curation.get("brief", {}).get(digest["id"])
    if cur_brief:
        brief = [{"priority": b["priority"], "text": b["text"], **({"due": b["due"]} if b.get("due") else {})} for b in cur_brief]
    else:
        brief = [{"priority": t["priority"], "text": t["text"][:90], **({"due": t["due"]} if t["due"] else {})}
                 for t in sorted([t for t in todos if not t["overdue"]], key=lambda t: (pr_rank[t["priority"]], t["due"] or "9999"))[:3]]
    decisions = curation.get("decisions", {}).get(digest["id"], [])

    high = sum(1 for n in news_items if n["impact"] == "high")
    kpis = [
        {"id": "news", "value": len(news_items), "label": "本期新動態", "note": f"高影響 {high} 則", "href": "#/news", "tone": "default"},
        {"id": "retire", "value": len(window), "label": "30 天內退役", "note": f"最近一筆 {short_date(retire_rows[0]['date'])}" if retire_rows else "無", "href": "#/retire", "tone": "alert" if window else "default"},
        {"id": "models", "value": sum(1 for u in ui_models if u["platformStatus"] == "evaluating"), "label": "評估中的模型",
         "note": "還沒有核准上線" if not any(u["platformStatus"] == "ga" for u in ui_models) else "", "href": "#/models", "tone": "default"},
        {"id": "todo", "value": p01_open, "label": "待辦 P0 / P1", "note": f"另有 {overdue} 項已過期限" if overdue else "沒有過期項目", "href": "#/adoption", "tone": "alert" if p01_open else "default"},
    ]

    # ------------------------------------------------------------------ open models
    heat_rank = {"hit": 0, "rising": 1, "watch": 2}
    oms = sorted(open_models["models"], key=lambda o: (heat_rank.get(o.get("heat"), 9), o["name"]))
    def host_text(o):
        parts = []
        for cloud, label in (("aws", "AWS"), ("azure", "Azure"), ("gcp", "GCP")):
            hs = [h for h in o.get("hosting", []) if h["cloud"] == cloud]
            if not hs:
                continue
            st = sorted({h["status"] for h in hs}, key=lambda s: ["ga", "preview", "limited-access", "not-offered"].index(s) if s in ["ga", "preview", "limited-access", "not-offered"] else 9)
            parts.append(f"{label} {STATUS_LABEL.get(st[0], st[0])}")
        return "、".join(parts) or "三雲未確認"
    open_items = [{"id": o["id"], "name": o["name"], "host": host_text(o), "heat": o.get("heat"), "status": o.get("status"),
                   "meta": f"{o.get('developer', '')}（{o.get('origin', '')}）· " + LICENSE.get((o.get("weights") or {}).get("license") or "", (o.get("weights") or {}).get("license") or "授權未確認"),
                   "releaseDate": o.get("releaseDate")} for o in oms]

    # ------------------------------------------------------------------ adoption board
    gate_titles = {g["id"]: g.get("title") or g.get("name") for g in requirements["gates"]}
    def first_open_gate(u):
        for gg in u["gates"]:
            if gg["state"] != "ok":
                return gg["gate"]
        return "G10"
    col_items = {"intake": [], "research": [], "compliance": [], "technical": [], "release": [], "retire": []}
    for w in catalog["watchlist"]:
        col_items["intake"].append({"title": w["name"], "tag": WATCH_STATUS.get(w["status"], w["status"]), "tone": "dashed"})
    for u in ui_models:
        g0 = first_open_gate(u)
        sec_row = u["security"]
        if sec_row:
            col_items["technical"].append({"title": u["name"], "modelId": u["id"],
                                           "tag": f"G6 未通過 {sec_row['fail']}" if sec_row["fail"] else "G6 通過", "tone": "danger" if sec_row["fail"] else "ok"})
        elif g0 == "G1":
            col_items["research"].append({"title": u["name"], "modelId": u["id"], "tag": "模型卡撰寫中", "tone": "chip"})
        else:
            col_items["compliance"].append({"title": u["name"], "modelId": u["id"], "tag": "待法遵審查", "tone": "warn"})
    for r in retire_rows:
        col_items["retire"].append({"title": f"{r['what']}（{r['where']}）", "tag": f"剩 {r['days']} 天", "tone": "danger" if r["days"] <= 14 else "warn"})
    board = [
        {"id": "intake", "title": "偵測與申請", "gates": "G0", "items": col_items["intake"]},
        {"id": "research", "title": "研究與模型卡", "gates": "G1", "items": col_items["research"]},
        {"id": "compliance", "title": "法遵與資料", "gates": "G2", "items": col_items["compliance"]},
        {"id": "technical", "title": "技術驗證", "gates": "G3–G7", "items": col_items["technical"]},
        {"id": "release", "title": "Beta 與上線", "gates": "G8–G9", "items": col_items["release"], "empty": "目前沒有模型進入 Beta。"},
        {"id": "retire", "title": "退役遷移", "gates": "G10", "items": col_items["retire"]},
    ]

    watch = [{"name": w["name"], "vendor": w["vendor"], "vendorLabel": VENDOR_LABEL.get(w["vendor"], w["vendor"]), "status": w["status"],
              "statusLabel": WATCH_STATUS.get(w["status"], w["status"]), "expected": w.get("expected"), "note": w["note"], "sources": refs(w.get("sources"))}
             for w in catalog["watchlist"]]

    src_out = {sid: {"title": sources[sid]["title"], "url": sources[sid]["url"], "publisher": sources[sid]["publisher"], "accessed": sources[sid]["accessed"]}
               for sid in sorted(used_sources)}

    ui = OrderedDict([
        ("schema", "llmops-ui/v1"),
        ("generatedAt", radar["generatedAt"]),
        ("asOf", as_of),
        ("locale", "zh-TW"),
        ("period", {"id": digest["id"], "start": digest["periodStart"], "end": digest["periodEnd"], "headline": digest["headline"]}),
        ("inputs", {"catalogAsOf": catalog["asOf"], "lifecycleAsOf": lifecycle["asOf"], "radarAsOf": radar["asOf"], "digest": digest["id"],
                    "digestCount": len(digests), "securityRun": sec["runId"] if sec else None}),
        ("brief", brief),
        ("kpis", kpis),
        ("news", {"periodCount": len(news_items), "totalCount": total_cards, "items": news_items, "checks": checks}),
        ("retirements", {"windowDays": 30, "eventCount": len(window), "rows": retire_rows, "noSoonerThan": nst, "later": later[:8], "priceChanges": price_changes}),
        ("tiers", tiers),
        ("models", ui_models),
        ("priceBands", bands),
        ("openModels", {"tracked": len(open_items), "items": open_items[:6], "asOf": open_models.get("asOf")}),
        ("tests", {"security": security,
                   "compat": {"runs": len(compat_runs), "note": "還沒有實測結果。要對每條路由（模型 × 雲 × endpoint）比較直連與經 LiteLLM。" if not compat_runs else ""},
                   "perf": {"runs": len(perf_runs), "note": "還沒有實測結果。" if not perf_runs else ""},
                   "cost": {"note": "目前以牌價試算，模型頁可選用量情境；帳單資料接上後改用實際值。"}}),
        ("gates", [{"gate": k, "title": gate_titles.get(k, k)} for k in GATES]),
        ("decisions", decisions),
        ("todos", todos),
        ("board", board),
        ("watchlist", watch),
        ("unverified", radar.get("unverified", [])),
        ("sources", src_out),
    ])
    return ui


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if cur != text:
            print("frontend/data/ui.json is stale: run python3 tools/build_ui_data.py", file=sys.stderr)
            sys.exit(1)
        print("frontend/data/ui.json is current")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    ui = json.loads(text)
    print(f"built frontend/data/ui.json: asOf {ui['asOf']}, {len(ui['models'])} models, {ui['news']['periodCount']} news, "
          f"{len(ui['retirements']['rows'])} retirement rows, {len(ui['todos'])} todos, {len(ui['sources'])} sources")


if __name__ == "__main__":
    main()
