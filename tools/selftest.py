#!/usr/bin/env python3
"""End-to-end self-test: mock gateway -> compat suite -> perf probe -> inventory sync -> schema validation.

  python3 tools/selftest.py        # no credentials, no model spend; ~20 s

Use it in CI whenever the tools or the schema change.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time

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


def main():
    port = free_port()
    gw = f"http://127.0.0.1:{port}"
    srv = subprocess.Popen([PY, os.path.join(HERE, "mock_gateway.py"), "--port", str(port)], stdout=subprocess.PIPE, text=True)
    failures = []
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
        import shutil
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
