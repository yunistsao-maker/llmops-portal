#!/usr/bin/env python3
"""Gateway-level latency / throughput probe for OpenAI-compatible endpoints (e.g. LiteLLM proxy).

Measures, per request (streaming):
  TTFT   time to first token of any kind (reasoning delta, content or tool-call fragment)
  TTFAT  time to first *answer* token (content or tool call) — what a user actually waits for
  ITL    mean inter-token latency while the answer streams
  TTLT   time to last token (end-to-end latency)
  output tokens/s per request, aggregate output tokens/s, RPS, error rate by type, goodput vs SLO

Writes a PerfRun JSON (schema/llmops.schema.json#/definitions/PerfRun).

Example:
  export LITELLM_API_KEY=sk-...
  python3 tools/perf_probe.py --gateway https://llm-gateway.example.internal/v1 \
      --route claude-opus-5-5 --profile chat-short --effort medium \
      --concurrency 4 --requests 40 --slo-ttfat-ms 8000 --slo-ttlt-ms 60000 \
      --client-location "Taipei HQ" --out runs/perf/opus55-chat-short.json

Notes
  * Needs `pip install httpx`.
  * Token counts come from the provider's usage block (stream_options.include_usage), not a local tokenizer.
  * Managed APIs are usually quota-bound: stop raising concurrency once 429s appear and record the quota you had.
  * For heavy load tests or trace replay use NVIDIA AIPerf; this probe is for comparable, repeatable gateway checks.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

try:
    import httpx
except ImportError:  # pragma: no cover
    sys.exit("pip install httpx")

# ---------------------------------------------------------------------------
# Prompt profiles. Input sizes are approximate; the real count is read back from usage.
# ---------------------------------------------------------------------------
_EN_FILLER = (
    "Quarterly operations review. The platform team migrated three services to the new gateway, "
    "reduced median latency, and documented the remaining risks around quota limits and model retirements. "
)
_ZH_FILLER = (
    "本季營運檢討：平台團隊將三個服務遷移到新的閘道，降低了中位數延遲，"
    "並記錄了配額上限與模型退役相關的剩餘風險。"
)

PROFILES = {
    # name: (filler, approx_input_tokens, chars_per_token_estimate, instruction, max_output)
    "chat-short": (_EN_FILLER, 1000, 4.0, "Summarize the key risks in five bullet points.", 300),
    "rag-long": (_EN_FILLER, 32000, 4.0, "Using only the context above, list every risk mentioned and its owner.", 800),
    "zh-tw": (_ZH_FILLER, 1000, 1.3, "請用繁體中文列出五點主要風險，並使用台灣慣用語。", 400),
    "tiny": (_EN_FILLER, 100, 4.0, "Reply with one short sentence.", 50),
}


def build_prompt(profile: str) -> tuple[str, int]:
    filler, approx_tokens, cpt, instruction, max_out = PROFILES[profile]
    target_chars = int(approx_tokens * cpt)
    body = (filler * (target_chars // len(filler) + 1))[:target_chars]
    return f"{body}\n\n{instruction}", max_out


# ---------------------------------------------------------------------------
@dataclass
class Sample:
    ok: bool
    error_type: str | None = None
    status: int | None = None
    ttft: float | None = None  # seconds
    ttfat: float | None = None
    ttlt: float | None = None
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    prompt_tokens: int = 0
    cached_tokens: int = 0
    finish_reason: str | None = None
    response_model: str | None = None
    answer_chunk_times: list[float] = field(default_factory=list)


def percentiles(values: list[float]) -> dict:
    vals = sorted(v for v in values if v is not None)
    n = len(vals)

    def pct(p: float):
        if not vals:
            return None
        k = (n - 1) * p
        lo, hi = int(k), min(int(k) + 1, n - 1)
        return round(vals[lo] + (vals[hi] - vals[lo]) * (k - lo), 3)

    return {
        "n": n,
        "p50": pct(0.50),
        "p90": pct(0.90),
        "p99": pct(0.99),
        "mean": round(sum(vals) / n, 3) if n else None,
        "min": round(vals[0], 3) if n else None,
        "max": round(vals[-1], 3) if n else None,
    }


def _has_reasoning(delta: dict) -> bool:
    return bool(delta.get("reasoning_content") or delta.get("thinking_blocks") or delta.get("reasoning"))


async def one_request(client: httpx.AsyncClient, url: str, headers: dict, payload: dict, timeout: float) -> Sample:
    s = Sample(ok=False)
    t0 = time.perf_counter()
    try:
        async with client.stream("POST", url, headers=headers, json=payload, timeout=timeout) as r:
            s.status = r.status_code
            if r.status_code != 200:
                body = (await r.aread()).decode("utf-8", "replace")[:300]
                s.error_type = "429" if r.status_code == 429 else ("5xx" if r.status_code >= 500 else f"http_{r.status_code}")
                s.finish_reason = body
                return s
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                now = time.perf_counter() - t0
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    s.error_type = "stream_error"
                    s.finish_reason = str(chunk["error"])[:300]
                    return s
                s.response_model = chunk.get("model") or s.response_model
                for ch in chunk.get("choices") or []:
                    delta = ch.get("delta") or {}
                    answer = bool(delta.get("content")) or bool(delta.get("tool_calls"))
                    if (answer or _has_reasoning(delta)) and s.ttft is None:
                        s.ttft = now
                    if answer:
                        if s.ttfat is None:
                            s.ttfat = now
                        s.answer_chunk_times.append(now)
                    if ch.get("finish_reason"):
                        s.finish_reason = ch["finish_reason"]
                usage = chunk.get("usage")
                if usage:
                    s.completion_tokens = int(usage.get("completion_tokens") or 0)
                    s.prompt_tokens = int(usage.get("prompt_tokens") or 0)
                    ctd = usage.get("completion_tokens_details") or {}
                    s.reasoning_tokens = int(ctd.get("reasoning_tokens") or 0)
                    ptd = usage.get("prompt_tokens_details") or {}
                    s.cached_tokens = int(ptd.get("cached_tokens") or usage.get("cache_read_input_tokens") or 0)
                s.ttlt = now
            s.ok = s.ttlt is not None
            if not s.ok:
                s.error_type = "empty_stream"
    except httpx.TimeoutException:
        s.error_type = "timeout"
    except httpx.HTTPError as e:
        s.error_type = f"transport:{type(e).__name__}"
    return s


async def run(args) -> dict:
    api_key = os.environ.get(args.api_key_env, "")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = args.gateway.rstrip("/") + "/chat/completions"
    prompt, default_max = build_prompt(args.profile)
    max_out = args.max_output or default_max
    payload = {
        "model": args.route,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "stream_options": {"include_usage": True},
        args.max_tokens_param: max_out,
    }
    if args.effort:
        payload["reasoning_effort"] = args.effort
    if args.extra_json:
        payload.update(json.loads(args.extra_json))

    samples: list[Sample] = []
    queue: asyncio.Queue[int] = asyncio.Queue()
    for i in range(args.requests):
        queue.put_nowait(i)

    limits = httpx.Limits(max_connections=args.concurrency * 2, max_keepalive_connections=args.concurrency)
    async with httpx.AsyncClient(limits=limits, http2=False) as client:
        for _ in range(args.warmup):
            await one_request(client, url, headers, payload, args.timeout)

        started = datetime.now(timezone.utc)
        wall0 = time.perf_counter()

        async def worker():
            while True:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                samples.append(await one_request(client, url, headers, payload, args.timeout))

        await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        wall = time.perf_counter() - wall0
        finished = datetime.now(timezone.utc)

    ok = [s for s in samples if s.ok]
    errors: dict[str, int] = {}
    for s in samples:
        if not s.ok:
            errors[s.error_type or "unknown"] = errors.get(s.error_type or "unknown", 0) + 1
    finish: dict[str, int] = {}
    models: dict[str, int] = {}
    for s in ok:
        finish[s.finish_reason or "none"] = finish.get(s.finish_reason or "none", 0) + 1
        if s.response_model:
            models[s.response_model] = models.get(s.response_model, 0) + 1

    def ms(v):
        return None if v is None else v * 1000.0

    itl = []
    tps = []
    for s in ok:
        answer_tokens = max(s.completion_tokens - s.reasoning_tokens, 0)
        if s.ttfat is not None and s.ttlt is not None and answer_tokens > 1:
            itl.append((s.ttlt - s.ttfat) / (answer_tokens - 1) * 1000.0)
        if s.ttft is not None and s.ttlt is not None and s.ttlt > s.ttft and s.completion_tokens:
            tps.append(s.completion_tokens / (s.ttlt - s.ttft))

    total_out = sum(s.completion_tokens for s in ok)
    goodput = None
    if args.slo_ttfat_ms or args.slo_ttlt_ms:
        good = 0
        for s in ok:
            c1 = args.slo_ttfat_ms is None or (s.ttfat is not None and s.ttfat * 1000 <= args.slo_ttfat_ms)
            c2 = args.slo_ttlt_ms is None or (s.ttlt is not None and s.ttlt * 1000 <= args.slo_ttlt_ms)
            good += int(c1 and c2)
        goodput = round(100.0 * good / max(len(samples), 1), 2)

    notes = [
        f"finish_reason counts: {json.dumps(finish, ensure_ascii=False)}",
        f"response.model counts: {json.dumps(models, ensure_ascii=False)}（與 route 不同時可能是 safeguard fallback 或 alias 設定）",
        f"max tokens parameter: {args.max_tokens_param}={max_out}",
        f"warmup requests excluded: {args.warmup}",
    ]
    if any(s.ttfat is None for s in ok):
        notes.append("部分成功請求沒有 answer token（可能只有 reasoning 或被截斷），TTFAT 以 null 計。")

    run_obj = {
        "schema": "perf-run/v1",
        "runId": args.run_id or f"perf-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}",
        "startedAt": started.isoformat().replace("+00:00", "Z"),
        "finishedAt": finished.isoformat().replace("+00:00", "Z"),
        "gateway": args.gateway,
        "route": args.route,
        "clientLocation": args.client_location,
        "profile": {
            "name": args.profile,
            "approxInputTokens": PROFILES[args.profile][1],
            "maxOutputTokens": max_out,
            "concurrency": args.concurrency,
            "requests": args.requests,
            "stream": True,
        },
        "metrics": {
            "ttftMs": percentiles([ms(s.ttft) for s in ok]),
            "ttfatMs": percentiles([ms(s.ttfat) for s in ok]),
            "itlMs": percentiles(itl),
            "ttltMs": percentiles([ms(s.ttlt) for s in ok]),
            "outputTokensPerSec": percentiles(tps),
            "aggregateOutputTokensPerSec": round(total_out / wall, 3) if wall > 0 else 0.0,
            "requestsPerSec": round(len(ok) / wall, 3) if wall > 0 else 0.0,
            "errorRate": round((len(samples) - len(ok)) / max(len(samples), 1), 4),
            "errorsByType": errors,
        },
        "usage": {
            "inputTokens": sum(s.prompt_tokens for s in ok),
            "outputTokens": total_out,
            "reasoningTokens": sum(s.reasoning_tokens for s in ok),
            "cachedInputTokens": sum(s.cached_tokens for s in ok),
        },
        "notes": notes,
    }
    if args.effort:
        run_obj["profile"]["reasoningEffort"] = args.effort
    if goodput is not None:
        run_obj["metrics"]["goodputPct"] = goodput
    slo = {}
    if args.slo_ttfat_ms:
        slo["ttfatMs"] = args.slo_ttfat_ms
    if args.slo_ttlt_ms:
        slo["ttltMs"] = args.slo_ttlt_ms
    if slo:
        run_obj["slo"] = slo
    if not args.client_location:
        run_obj.pop("clientLocation")
    return run_obj


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gateway", required=True, help="Base URL incl. /v1, e.g. https://llm-gateway/v1")
    ap.add_argument("--api-key-env", default="LITELLM_API_KEY")
    ap.add_argument("--route", required=True, help="Gateway model alias to call")
    ap.add_argument("--profile", choices=sorted(PROFILES), default="chat-short")
    ap.add_argument("--effort", help="reasoning_effort to send (low|medium|high|xhigh|max|none)")
    ap.add_argument("--max-output", type=int, help="Override the profile's max output tokens")
    ap.add_argument("--max-tokens-param", default="max_tokens", choices=["max_tokens", "max_completion_tokens"])
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--requests", type=int, default=10)
    ap.add_argument("--warmup", type=int, default=1)
    ap.add_argument("--timeout", type=float, default=900.0)
    ap.add_argument("--slo-ttfat-ms", type=float)
    ap.add_argument("--slo-ttlt-ms", type=float)
    ap.add_argument("--client-location")
    ap.add_argument("--extra-json", help="JSON object merged into the request body")
    ap.add_argument("--run-id")
    ap.add_argument("--out", help="Write PerfRun JSON here (directories are created)")
    args = ap.parse_args()
    if args.concurrency < 1 or args.requests < 1:
        ap.error("--concurrency and --requests must be >= 1")

    result = asyncio.run(run(args))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    m = result["metrics"]
    print(f"route={result['route']} ok={m['ttltMs']['n']}/{args.requests} errors={m['errorsByType']}")
    for key in ("ttftMs", "ttfatMs", "itlMs", "ttltMs", "outputTokensPerSec"):
        p = m[key]
        print(f"  {key:<20} p50={p['p50']} p90={p['p90']} p99={p['p99']}")
    print(f"  aggregate tok/s={m['aggregateOutputTokensPerSec']} rps={m['requestsPerSec']} goodput={m.get('goodputPct')}")
    if args.out:
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
