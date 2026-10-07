#!/usr/bin/env python3
"""API-compatibility suite for gateway routes (LiteLLM or any OpenAI-compatible proxy).

Runs parameter-level cases against every route and writes a CompatRun JSON
(schema/llmops.schema.json#/definitions/CompatRun). A route is a gateway alias such as
"claude-opus-5-5@bedrock-jp" — test each CSP route separately, and run the same suite
directly against the CSP when you need to tell gateway bugs from provider limits.

Example:
  export LITELLM_API_KEY=sk-...
  python3 tools/compat_suite.py --gateway https://llm-gateway.example.internal/v1 \
      --routes claude-opus-5-5,claude-opus-5-5@vertex,gpt-6-astra,gpt-6-astra@bedrock \
      --litellm-version v1.102.1 --out runs/compat/2026-09-25.json --fail-on-required

Cases are plain Python below — add your own (e.g. a zh-TW script check or an internal tool schema).
Every case costs at least one model call; `--cases` limits the run.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

try:
    import httpx
except ImportError:  # pragma: no cover
    sys.exit("pip install httpx")


def _png_2x2_red() -> str:
    """A tiny valid PNG (2x2 red) as a data URL — no files needed."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 2 for _ in range(2))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode()


WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
    },
}
LONG_PREFIX = ("Reference policy text for caching tests. " * 400).strip()  # ~2.4k tokens


@dataclass
class Case:
    id: str
    title: str
    required: bool
    endpoint: str  # chat | chat-stream | responses | messages
    build: Callable[[str], dict]
    check: Callable[[dict], tuple[str, str]]  # returns (status, detail)
    repeat: int = 1  # send the same request N times; check sees the last response


def _msg(content):
    return [{"role": "user", "content": content}]


def _text(resp: dict) -> str:
    try:
        return resp["choices"][0]["message"].get("content") or ""
    except (KeyError, IndexError, TypeError):
        return ""


def _tool_calls(resp: dict):
    try:
        return resp["choices"][0]["message"].get("tool_calls") or []
    except (KeyError, IndexError, TypeError):
        return []


def ok_if(cond: bool, good: str, bad: str) -> tuple[str, str]:
    return ("pass", good) if cond else ("fail", bad)


CASES: list[Case] = [
    Case("chat.basic", "Chat Completions 基本回應", True, "chat",
         lambda r: {"model": r, "messages": _msg("Reply with the single word: pong"), "max_tokens": 256},
         lambda resp: ok_if(bool(_text(resp).strip()), "非空回應", "回應內容為空")),
    Case("chat.system", "System prompt", False, "chat",
         lambda r: {"model": r, "messages": [{"role": "system", "content": "Always answer in Traditional Chinese."}, {"role": "user", "content": "Say hello."}], "max_tokens": 256},
         lambda resp: ok_if(bool(_text(resp).strip()), "非空回應", "回應內容為空")),
    Case("chat.stream", "串流（SSE）", True, "chat-stream",
         lambda r: {"model": r, "messages": _msg("Count from 1 to 5."), "max_tokens": 256, "stream": True},
         lambda resp: ok_if(resp.get("_chunks", 0) > 0 and bool(resp.get("_text")), f"{resp.get('_chunks')} chunks", "沒有收到內容 chunk")),
    Case("chat.stream_usage", "串流 usage（stream_options.include_usage）", False, "chat-stream",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 256, "stream": True, "stream_options": {"include_usage": True}},
         lambda resp: ok_if(bool(resp.get("_usage", {}).get("completion_tokens")), f"usage={resp.get('_usage')}", "最後沒有 usage chunk（成本追蹤會失準）")),
    Case("params.max_tokens", "max_tokens 參數", True, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 512},
         lambda resp: ("pass", "accepted")),
    Case("params.max_completion_tokens", "max_completion_tokens 參數", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_completion_tokens": 512},
         lambda resp: ("pass", "accepted")),
    Case("params.temperature", "temperature=0（reasoning 模型常拒收，gateway 應丟棄）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 256, "temperature": 0},
         lambda resp: ("pass", "accepted or dropped by gateway")),
    Case("params.reasoning_effort", "reasoning_effort=low", False, "chat",
         lambda r: {"model": r, "messages": _msg("Is 17 prime? Answer yes or no."), "max_tokens": 1024, "reasoning_effort": "low"},
         lambda resp: ok_if(bool(_text(resp).strip()), "accepted", "回應內容為空")),
    Case("tools.auto", "Tool calling（tool_choice=auto）", True, "chat",
         lambda r: {"model": r, "messages": _msg("What's the weather in Taipei right now? Use the tool."), "tools": [WEATHER_TOOL], "max_tokens": 1024},
         lambda resp: ok_if(len(_tool_calls(resp)) > 0, "有 tool_calls", "沒有呼叫工具")),
    Case("tools.forced", "Forced tool_choice（指定函式）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Hello"), "tools": [WEATHER_TOOL],
                    "tool_choice": {"type": "function", "function": {"name": "get_weather"}}, "max_tokens": 1024},
         lambda resp: ok_if(len(_tool_calls(resp)) > 0, "有 tool_calls", "HTTP 200 但沒有 tool_calls：forced tool_choice 可能被 gateway 靜默降級為 auto")),
    Case("structured.json_schema", "Structured output（response_format json_schema）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Return the capital of Japan."), "max_tokens": 1024,
                    "response_format": {"type": "json_schema", "json_schema": {"name": "capital", "strict": True, "schema": {
                        "type": "object", "properties": {"country": {"type": "string"}, "capital": {"type": "string"}},
                        "required": ["country", "capital"], "additionalProperties": False}}}},
         lambda resp: _check_json(_text(resp), ["country", "capital"])),
    Case("vision.image", "影像輸入（data URL）", False, "chat",
         lambda r: {"model": r, "max_tokens": 512, "messages": [{"role": "user", "content": [
             {"type": "text", "text": "What color is this image? One word."},
             {"type": "image_url", "image_url": {"url": _png_2x2_red()}}]}]},
         lambda resp: ok_if(bool(_text(resp).strip()), "非空回應", "回應內容為空")),
    Case("usage.cache", "Prompt caching（重複長前綴，第二次應有 cached tokens）", False, "chat",
         lambda r: {"model": r, "max_tokens": 128, "messages": [{"role": "system", "content": LONG_PREFIX}, {"role": "user", "content": "Reply OK."}]},
         lambda resp: _check_cache(resp), repeat=2),
    Case("responses.basic", "Responses API（/v1/responses）", False, "responses",
         lambda r: {"model": r, "input": "Reply with the single word: pong", "max_output_tokens": 256},
         lambda resp: ok_if(bool(_responses_text(resp)), "有 output_text", "沒有文字輸出")),
    Case("responses.tools", "Responses API + function tool", False, "responses",
         lambda r: {"model": r, "input": "What's the weather in Taipei? Use the tool.", "max_output_tokens": 1024,
                    "tools": [{"type": "function", "name": "get_weather", "description": "Get the current weather for a city.",
                               "parameters": WEATHER_TOOL["function"]["parameters"]}]},
         lambda resp: ok_if(any(i.get("type") == "function_call" for i in resp.get("output", [])), "有 function_call", "沒有 function_call")),
    Case("messages.basic", "Anthropic Messages（/v1/messages）", False, "messages",
         lambda r: {"model": r, "max_tokens": 256, "messages": _msg("Reply with the single word: pong")},
         lambda resp: ok_if(any(b.get("type") == "text" and b.get("text") for b in resp.get("content", [])), f"stop_reason={resp.get('stop_reason')}", "沒有 text block")),
    Case("meta.response_model", "回應的 model 欄位（偵測 fallback / alias）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 256},
         lambda resp: ok_if(bool(resp.get("model")), f"response.model={resp.get('model')}", "回應沒有 model 欄位")),
]


def _check_json(text: str, keys: list[str]) -> tuple[str, str]:
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
    try:
        obj = json.loads(t)
    except json.JSONDecodeError:
        return "fail", f"不是合法 JSON：{text[:80]!r}"
    missing = [k for k in keys if k not in obj]
    return ("fail", f"缺少欄位 {missing}") if missing else ("pass", "符合 schema 必填欄位")


def _check_cache(resp: dict) -> tuple[str, str]:
    u = resp.get("usage") or {}
    cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens") or u.get("cache_read_input_tokens") or 0
    return ok_if(cached > 0, f"cached_tokens={cached}", f"第二次請求沒有 cached tokens（usage={json.dumps(u)[:160]}）")


def _responses_text(resp: dict) -> str:
    if resp.get("output_text"):
        return resp["output_text"]
    parts = []
    for item in resp.get("output", []) or []:
        for c in item.get("content", []) or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                parts.append(c["text"])
    return "".join(parts)


def call(client: httpx.Client, base: str, key: str, case: Case, route: str, timeout: float) -> dict:
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if case.endpoint == "messages":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
    path = {"chat": "/chat/completions", "chat-stream": "/chat/completions", "responses": "/responses", "messages": "/messages"}[case.endpoint]
    payload = case.build(route)
    t0 = time.perf_counter()
    if case.endpoint == "chat-stream":
        chunks, text, usage, status = 0, [], {}, None
        with client.stream("POST", base + path, headers=headers, json=payload, timeout=timeout) as r:
            status = r.status_code
            if status != 200:
                return {"_status": status, "_error": r.read().decode("utf-8", "replace")[:400], "_ms": (time.perf_counter() - t0) * 1000}
            for line in r.iter_lines():
                if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                    continue
                try:
                    c = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if c.get("usage"):
                    usage = c["usage"]
                for ch in c.get("choices") or []:
                    d = ch.get("delta") or {}
                    if d.get("content"):
                        chunks += 1
                        text.append(d["content"])
        return {"_status": status, "_chunks": chunks, "_text": "".join(text), "_usage": usage, "_ms": (time.perf_counter() - t0) * 1000}
    r = client.post(base + path, headers=headers, json=payload, timeout=timeout)
    ms = (time.perf_counter() - t0) * 1000
    try:
        body = r.json()
    except ValueError:
        body = {"_raw": r.text[:400]}
    if r.status_code != 200:
        return {"_status": r.status_code, "_error": json.dumps(body, ensure_ascii=False)[:400], "_ms": ms}
    body["_status"] = r.status_code
    body["_ms"] = ms
    return body


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gateway", help="Base URL incl. /v1 (required unless --list)")
    ap.add_argument("--api-key-env", default="LITELLM_API_KEY")
    ap.add_argument("--routes", help="Comma-separated gateway aliases (required unless --list)")
    ap.add_argument("--cases", default="all", help="Comma-separated case ids, or 'all' / 'required'")
    ap.add_argument("--timeout", type=float, default=300.0)
    ap.add_argument("--litellm-version")
    ap.add_argument("--out")
    ap.add_argument("--fail-on-required", action="store_true", help="Exit 2 if any required case fails")
    ap.add_argument("--list", action="store_true", help="List cases and exit")
    args = ap.parse_args()

    if args.list:
        for c in CASES:
            print(f"{c.id:<28} {'required' if c.required else 'optional':<9} {c.endpoint:<11} {c.title}")
        return
    if not args.gateway or not args.routes:
        ap.error("--gateway and --routes are required (unless --list)")
    if args.cases == "all":
        cases = CASES
    elif args.cases == "required":
        cases = [c for c in CASES if c.required]
    else:
        wanted = set(args.cases.split(","))
        cases = [c for c in CASES if c.id in wanted]
        unknown = wanted - {c.id for c in cases}
        if unknown:
            ap.error(f"unknown case ids: {sorted(unknown)}")

    routes = [r.strip() for r in args.routes.split(",") if r.strip()]
    key = os.environ.get(args.api_key_env, "")
    base = args.gateway.rstrip("/")
    started = datetime.now(timezone.utc)
    results = []
    with httpx.Client() as client:
        for route in routes:
            for case in cases:
                try:
                    resp = {}
                    for _ in range(case.repeat):
                        resp = call(client, base, key, case, route, args.timeout)
                        if resp.get("_status") != 200:
                            break
                    if resp.get("_status") != 200:
                        status, detail = "fail", resp.get("_error", "")
                    else:
                        status, detail = case.check(resp)
                    results.append({"route": route, "caseId": case.id, "status": status, "httpStatus": resp.get("_status"),
                                    "latencyMs": round(resp.get("_ms", 0.0), 1), "detail": detail[:500]})
                except httpx.HTTPError as e:
                    results.append({"route": route, "caseId": case.id, "status": "error", "detail": f"{type(e).__name__}: {e}"[:500]})
                last = results[-1]
                print(f"{route:<34} {case.id:<28} {last['status']:<5} {last.get('httpStatus', '')} {last['detail'][:90]}")
    finished = datetime.now(timezone.utc)

    required_ids = {c.id for c in cases if c.required}
    summary = []
    for route in routes:
        rs = [r for r in results if r["route"] == route]
        summary.append({
            "route": route,
            "pass": sum(r["status"] == "pass" for r in rs),
            "fail": sum(r["status"] == "fail" for r in rs),
            "error": sum(r["status"] == "error" for r in rs),
            "skip": sum(r["status"] == "skip" for r in rs),
            "requiredFailures": [r["caseId"] for r in rs if r["caseId"] in required_ids and r["status"] != "pass"],
        })
    run = {
        "schema": "compat-run/v1",
        "runId": f"compat-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}",
        "startedAt": started.isoformat().replace("+00:00", "Z"),
        "finishedAt": finished.isoformat().replace("+00:00", "Z"),
        "gateway": args.gateway,
        "routes": routes,
        "cases": [{"id": c.id, "title": c.title, "required": c.required} for c in cases],
        "results": [{k: v for k, v in r.items() if v is not None} for r in results],
        "summary": summary,
    }
    if args.litellm_version:
        run["litellmVersion"] = args.litellm_version
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(run, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"wrote {args.out}")
    for s in summary:
        flag = "✗" if s["requiredFailures"] else "✓"
        print(f"{flag} {s['route']}: pass={s['pass']} fail={s['fail']} error={s['error']} required_failures={s['requiredFailures']}")
    if args.fail_on_required and any(s["requiredFailures"] for s in summary):
        sys.exit(2)


if __name__ == "__main__":
    main()
