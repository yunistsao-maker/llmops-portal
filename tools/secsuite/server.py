"""Local web UI for the security suite. Binds to 127.0.0.1 only.

  python3 tools/sec_suite.py ui            → http://127.0.0.1:8765

API keys are never typed into the page: targets refer to environment variable names
(or to the AWS credentials boto3 already finds), and the server reads them from its own environment.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import fetch, run

HERE = Path(__file__).resolve().parent
PROGRESS = run.Progress()
FETCH_LOG: list[str] = []
FETCH_BUSY = threading.Event()

PRESETS = {
    "bedrock": [
        {"label": "Sonnet 5.5", "provider": "bedrock", "model": "global.anthropic.claude-sonnet-5-5", "region": "us-east-1"},
        {"label": "Haiku 5.5", "provider": "bedrock", "model": "global.anthropic.claude-haiku-5-5", "region": "us-east-1"},
    ],
    "anthropic": [
        {"label": "Sonnet 5.5", "provider": "anthropic", "model": "claude-sonnet-5-5", "apiKeyEnv": "ANTHROPIC_API_KEY"},
        {"label": "Haiku 5.5", "provider": "anthropic", "model": "claude-haiku-5-5", "apiKeyEnv": "ANTHROPIC_API_KEY"},
    ],
    "gateway": [
        {"label": "Sonnet 5.5", "provider": "gateway", "model": "claude-sonnet-5-5", "baseUrl": "https://llm-gateway.example.internal/v1", "apiKeyEnv": "LITELLM_API_KEY"},
        {"label": "Haiku 5.5", "provider": "gateway", "model": "claude-haiku-5-5", "baseUrl": "https://llm-gateway.example.internal/v1", "apiKeyEnv": "LITELLM_API_KEY"},
    ],
    "mock": [
        {"label": "模擬 A（較穩健）", "provider": "mock", "model": "mock-strong"},
        {"label": "模擬 B（較脆弱）", "provider": "mock", "model": "mock-weak"},
    ],
}


def state() -> dict:
    return {"catalog": run.CATALOG, "plan": fetch.plan(), "presets": PRESETS, "runs": run.list_runs(),
            "progress": PROGRESS.snapshot(), "fetchBusy": FETCH_BUSY.is_set(), "fetchLog": FETCH_LOG[-30:], "live": True}


def preview(item: str, n: int, seed: int) -> list[dict]:
    """The sampled cases for an item, shown before any model is called."""
    out = []
    for c in fetch.sample_item(item, n, seed):
        if c["kind"] == "multi":
            view = [{"role": "user", "content": run._clip(t, 1500)} for t in c["turns"]]
        elif c["kind"] == "pair":
            view = [{"role": "user", "content": "[基準] " + run._clip(c["messages"][0]["content"], 1200)},
                    {"role": "user", "content": "[變體] " + run._clip(c["messages_b"][0]["content"], 1800)}]
        else:
            view = run._show_messages(c["messages"])
        out.append({"item": item, "dataset": c["dataset"], "caseId": c["id"], "category": c["category"], "lang": c.get("lang"),
                    "system": run._clip(c.get("system"), 1500) if c.get("system") else None,
                    "tools": [t["function"]["name"] for t in c.get("tools") or []], "prompt": view})
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "secsuite"

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _local(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def do_GET(self):
        if not self._local():
            return self._send(403, {"error": "local access only"})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            return self._send(200, (HERE / "ui.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/state":
            return self._send(200, state())
        if u.path == "/api/progress":
            return self._send(200, {**PROGRESS.snapshot(), "fetchBusy": FETCH_BUSY.is_set(), "fetchLog": FETCH_LOG[-30:]})
        if u.path == "/api/results":
            doc = run.load_run(q.get("run", ["latest"])[0])
            return self._send(200, doc or {})
        if u.path == "/api/samples":
            item = q.get("item", [""])[0]
            if item not in run.ITEMS:
                return self._send(400, {"error": "unknown item"})
            return self._send(200, preview(item, int(q.get("n", ["10"])[0]), int(q.get("seed", ["7"])[0])))
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._local() or self.headers.get("X-Secsuite") != "1":
            return self._send(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})
        if self.path == "/api/fetch":
            ids = [i for i in body.get("ids", []) if i in fetch.DATASETS]
            if not body.get("approved") or not ids:
                return self._send(400, {"error": "需要勾選資料集並確認已了解風險"})
            if FETCH_BUSY.is_set():
                return self._send(409, {"error": "下載進行中"})

            def job():
                FETCH_BUSY.set()
                try:
                    for i in ids:
                        FETCH_LOG.append(f"{i}：開始")
                        try:
                            r = fetch.fetch(i, approved=True, log=FETCH_LOG.append)
                            FETCH_LOG.append(f"{i}：完成，{r['rows']} 筆")
                        except Exception as e:  # noqa: BLE001
                            FETCH_LOG.append(f"{i}：失敗 {type(e).__name__}: {e}"[:300])
                finally:
                    FETCH_BUSY.clear()
            threading.Thread(target=job, daemon=True).start()
            return self._send(200, {"ok": True})
        if self.path == "/api/run":
            if PROGRESS.snapshot()["running"]:
                return self._send(409, {"error": "已有測試在執行"})
            targets = [t for t in body.get("targets", []) if t.get("label") and t.get("provider") and t.get("model")]
            items = [i for i in body.get("items", []) if i in run.ITEMS]
            if not targets or not items:
                return self._send(400, {"error": "至少要有一個模型與一個測試項目"})
            cfg = {"targets": targets, "items": items, "judge": body.get("judge") or None, "incumbent": body.get("incumbent") or None,
                   "n": max(1, min(200, int(body.get("n", 10)))), "seed": int(body.get("seed", 7)),
                   "trials": max(1, min(10, int(body.get("trials", 1)))), "concurrency": max(1, min(16, int(body.get("concurrency", 4)))),
                   "maxTokens": max(256, min(32000, int(body.get("maxTokens", 2048)))), "litellmVersion": body.get("litellmVersion") or None}

            def job():
                try:
                    run.run(cfg, PROGRESS)
                except Exception as e:  # noqa: BLE001
                    with PROGRESS.lock:
                        PROGRESS.running, PROGRESS.error = False, f"{type(e).__name__}: {e}"[:400]
            with PROGRESS.lock:
                PROGRESS.running = True
            threading.Thread(target=job, daemon=True).start()
            return self._send(200, {"ok": True})
        if self.path == "/api/cancel":
            PROGRESS.cancel = True
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})


def serve(port: int = 8765):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"AI 安全測試 UI：http://127.0.0.1:{port}  （Ctrl+C 結束）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
