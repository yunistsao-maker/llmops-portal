#!/usr/bin/env python3
"""End-to-end self-test: Release Radar merge rules -> mock gateway -> compat suite -> perf probe -> inventory sync ->
schema validation.

  python3 tools/selftest.py        # no credentials, no model spend; ~20 s

Use it in CI whenever the tools or the schema change.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PY = sys.executable


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run(cmd, **kw):
    print("$", " ".join(cmd[1:]) if cmd[0] == PY else " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, **kw)


def radar_selftest(failures: list[str]) -> None:
    """tools/build_radar.py on three synthetic digests: topic / merges / check, curation topics / checks / close."""
    sys.path.insert(0, HERE)
    import build_radar as br

    src = [{"id": json.load(open(os.path.join(ROOT, "data/sources.json")))["sources"][0]["id"]}]
    item = lambda title, **kw: {"title": title, "detail": f"{title} 的說明", "impact": "low", "sources": src, **kw}
    act = lambda text, **kw: {"priority": "P1", "action": text, **kw}
    days = {
        "2026-10-01": {"pricingChanges": [item("X 價格 $1", topic="pricing:x"), item("Y 價格"), item("本期沒有牌價變動", check=True),
                                          item("W 的舊價格")],
                       "actionItems": [act("升級 gateway 到 v1", due="2026-10-10", topic="gw:upgrade"), act("盤點 Z 的使用", priority="P2")]},
        "2026-10-02": {"pricingChanges": [item("X 降價到 $0.5", topic="pricing:x"), item("Y 價格更正", merges=["Y 價格"]),
                                          item("本期沒有既有模型的牌價變動")],
                       "actionItems": [act("gateway 改升 v2：先在 staging 驗證，再通知使用者重新登入", due="2026-10-12", topic="gw:upgrade")]},
        "2026-10-03": {"pricingChanges": [item("W 價格公告"), item("V 價格", merges=["從來沒有出現過的標題"])], "actionItems": []},
    }
    tmp = tempfile.mkdtemp(prefix="llmops-radar-selftest-")
    os.makedirs(os.path.join(tmp, "data/digests"))
    os.makedirs(os.path.join(tmp, "radar"))
    os.makedirs(os.path.join(tmp, "schema"))
    for did, body in days.items():
        doc = {"schema": "digest/v1", "id": did, "locale": "zh-TW", "periodStart": did, "periodEnd": did,
               "generatedAt": f"{did}T00:00:00Z", "headline": f"{did} 摘要", "newModels": [], "lifecycleChanges": [],
               "pricingChanges": [], "litellm": [], "security": [], "regulatory": [], "watchlist": [], "unverified": [], **body}
        json.dump(doc, open(os.path.join(tmp, f"data/digests/{did}.json"), "w"), ensure_ascii=False)
    pid = lambda title: br.hid("it-", "pricingChanges", br.norm(title))
    aid = lambda text: br.hid("ai-", "", br.norm(text))
    curation = {"schema": "radar-curation/v1", "merge": [],
                "close": [{"id": aid("升級 gateway 到 v1"), "on": "2026-10-02", "reason": "被 v2 取代"},
                          {"id": aid("盤點 Z 的使用"), "on": "2026-10-03", "reason": "已完成"}],
                "topics": [{"topic": "pricing:w", "ids": [pid("W 的舊價格"), pid("W 價格公告")], "reason": "同一個模型的價格"}],
                "checks": [{"ids": [pid("本期沒有既有模型的牌價變動")], "reason": "複查紀錄"}]}
    json.dump(curation, open(os.path.join(tmp, "radar/curation.json"), "w"), ensure_ascii=False)
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        radar = br.build(Path(tmp))
    json.dump(radar, open(os.path.join(tmp, "data/radar.json"), "w"), ensure_ascii=False)
    cards = {c["title"]: c for c in radar["pricingChanges"]}
    want = {"X 降價到 $0.5": ("pricing:x", ["X 價格 $1"], pid("X 價格 $1")), "Y 價格更正": (None, ["Y 價格"], pid("Y 價格")),
            "W 價格公告": ("pricing:w", ["W 的舊價格"], pid("W 的舊價格")), "V 價格": (None, [], pid("V 價格"))}
    if set(cards) != set(want):
        failures.append(f"radar: pricing cards {sorted(cards)} (want {sorted(want)})")
    for title, (topic, older, cid) in want.items():
        c = cards.get(title, {})
        if c and (c.get("topic") != topic or [u["title"] for u in c.get("updates", [])] != older or c["id"] != cid):
            failures.append(f"radar: card {title!r}: topic {c.get('topic')}, updates {c.get('updates')}, id {c['id']} (want {topic}, {older}, {cid})")
    if [(c["date"], c["title"]) for c in radar["checks"]] != [("2026-10-02", "本期沒有既有模型的牌價變動")]:
        failures.append(f"radar: checks {radar['checks']} (want only the newest digest's coverage note)")
    up = [a for a in radar["actionItems"] if a.get("topic") == "gw:upgrade"]
    if len(up) != 1 or up[0]["action"] != "gateway 改升 v2：先在 staging 驗證，再通知使用者重新登入" or [u["action"] for u in up[0].get("updates", [])] != ["升級 gateway 到 v1"]:
        failures.append(f"radar: gw:upgrade should be one open item (a close on its older statement does not close it): {up}")
    if [(a["action"], a["reason"]) for a in radar["retired"]] != [("盤點 Z 的使用", "closed")]:
        failures.append(f"radar: retired {radar['retired']}")
    if "merges names no earlier entry" not in err.getvalue():
        failures.append("radar: an unresolved `merges` title should be reported on stderr")
    shutil.copy(os.path.join(ROOT, "schema/llmops.schema.json"), os.path.join(tmp, "schema/llmops.schema.json"))
    shutil.copy(os.path.join(ROOT, "data/sources.json"), os.path.join(tmp, "data/sources.json"))
    r = run([PY, "tools/validate_data.py", "--root", tmp])
    if r.returncode != 0:
        failures.append("radar: synthetic digests / curation / radar.json failed schema validation:\n" + r.stdout[-1500:])
    print("radar merge rules:", "ok" if not failures else "FAILED")


def main():
    failures = []
    radar_selftest(failures)
    port = free_port()
    gw = f"http://127.0.0.1:{port}"
    srv = subprocess.Popen([PY, os.path.join(HERE, "mock_gateway.py"), "--port", str(port)], stdout=subprocess.PIPE, text=True)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        tmp = tempfile.mkdtemp(prefix="llmops-selftest-")
        compat_out = os.path.join(tmp, "runs/compat/selftest.json")
        perf_out = os.path.join(tmp, "runs/perf/selftest.json")
        inv_out = os.path.join(tmp, "data/internal/platform-inventory.json")
        env = {**os.environ, "LITELLM_API_KEY": "sk-mock", "LITELLM_MASTER_KEY": "sk-mock"}

        r = run([PY, "tools/compat_suite.py", "--gateway", gw + "/v1", "--routes",
                 "mock-good,mock-reasoning,mock-no-temp,mock-no-forced,mock-silent-forced,mock-no-schema",
                 "--litellm-version", "1.102.1-mock", "--out", compat_out], env=env)
        print(r.stdout[-2500:], r.stderr[-800:])
        if r.returncode != 0:
            failures.append("compat_suite exited non-zero")
        compat = json.load(open(compat_out))
        by = {(x["route"], x["caseId"]): x["status"] for x in compat["results"]}
        expect = {
            ("mock-good", "chat.basic"): "pass",
            ("mock-good", "tools.forced"): "pass",
            ("mock-good", "usage.cache"): "pass",
            ("mock-good", "structured.json_schema"): "pass",
            ("mock-no-temp", "params.temperature"): "fail",
            ("mock-no-forced", "tools.forced"): "fail",
            ("mock-silent-forced", "tools.forced"): "fail",
            ("mock-no-schema", "structured.json_schema"): "fail",
            ("mock-reasoning", "chat.stream"): "pass",
        }
        for k, v in expect.items():
            if by.get(k) != v:
                failures.append(f"compat expectation {k} -> {by.get(k)} (want {v})")

        r = run([PY, "tools/perf_probe.py", "--gateway", gw + "/v1", "--route", "mock-reasoning", "--profile", "tiny",
                 "--effort", "low", "--concurrency", "4", "--requests", "16", "--slo-ttfat-ms", "2000", "--slo-ttlt-ms", "5000",
                 "--client-location", "selftest", "--out", perf_out], env=env)
        print(r.stdout[-1500:], r.stderr[-800:])
        if r.returncode != 0:
            failures.append("perf_probe exited non-zero")
        perf = json.load(open(perf_out))
        m = perf["metrics"]
        if m["ttltMs"]["n"] != 16:
            failures.append(f"perf: expected 16 ok samples, got {m['ttltMs']['n']}")
        if not (m["ttfatMs"]["p50"] and m["ttftMs"]["p50"] and m["ttfatMs"]["p50"] > m["ttftMs"]["p50"] + 100):
            failures.append(f"perf: TTFAT should exceed TTFT by the mock reasoning time: {m['ttftMs']['p50']} vs {m['ttfatMs']['p50']}")
        if perf["usage"]["reasoningTokens"] <= 0:
            failures.append("perf: reasoning tokens not captured from usage")

        r = run([PY, "tools/sync_inventory.py", "--gateway", gw, "--today", "2026-09-24", "--out", inv_out], env=env)
        print(r.stdout[-2000:], r.stderr[-800:])
        if r.returncode != 0:
            failures.append("sync_inventory exited non-zero")
        inv = json.load(open(inv_out))
        risk = {d["modelName"]: d["risk"] for d in inv["deployments"]}
        want = {"claude-sonnet-4": "act-now", "claude-3-haiku": "retired", "gpt-4o-prod": "ok", "o3-reasoning": "watch",
                "gemini-2.5-flash": "act-now", "internal-finetune": "unknown", "claude-opus-5-5": "ok"}
        for k, v in want.items():
            if risk.get(k) != v:
                failures.append(f"inventory risk {k} -> {risk.get(k)} (want {v})")
        if "sk-should-never-be-written" in open(inv_out).read():
            failures.append("inventory leaked a secret from litellm_params")

        # validate the generated run files with the real schema
        os.makedirs(os.path.join(tmp, "schema"), exist_ok=True)
        os.makedirs(os.path.join(tmp, "data"), exist_ok=True)
        shutil.copy(os.path.join(ROOT, "schema/llmops.schema.json"), os.path.join(tmp, "schema/llmops.schema.json"))
        shutil.copy(os.path.join(ROOT, "data/sources.json"), os.path.join(tmp, "data/sources.json"))
        r = run([PY, "tools/validate_data.py", "--root", tmp])
        print(r.stdout[-1500:], r.stderr[-500:])
        if r.returncode != 0:
            failures.append("generated run files failed schema validation")
    finally:
        srv.terminate()

    if failures:
        print("\nSELFTEST FAILED:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("\nSELFTEST PASSED")


if __name__ == "__main__":
    main()
