#!/usr/bin/env python3
"""Tiny OpenAI/LiteLLM-compatible mock gateway for testing the tools without spending tokens.

  python3 tools/mock_gateway.py --port 4010

Behaviour is picked by substrings in the requested model name:
  reasoning      stream reasoning_content before the answer (tests TTFT vs TTFAT)
  no-temp        HTTP 400 when temperature is sent (like GPT-6 on Bedrock via LiteLLM 1.102.1)
  no-forced      HTTP 400 on forced tool_choice (like Claude Opus 5.5 without drop_params)
  silent-forced  forced tool_choice silently becomes auto and no tool is called (drop_params downgrade)
  no-schema      ignores response_format and answers in prose
  flaky          ~25% HTTP 429
Endpoints: /v1/chat/completions, /v1/responses, /v1/messages, /model/info, /health/readiness
"""
from __future__ import annotations

import argparse
import json
import random
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_seen_prefixes: set[str] = set()
_lock = threading.Lock()

MODEL_INFO = {"data": [
    {"model_name": "claude-opus-5-5", "litellm_params": {"model": "bedrock/global.anthropic.claude-opus-5-5", "aws_region_name": "ap-east-2"}, "model_info": {"catalog_id": "claude-opus-5-5"}},
    {"model_name": "claude-sonnet-4", "litellm_params": {"model": "bedrock/apac.anthropic.claude-sonnet-4-20250514-v1:0"}, "model_info": {}},
    {"model_name": "claude-3-haiku", "litellm_params": {"model": "bedrock/anthropic.claude-3-haiku-20240307-v1:0"}, "model_info": {}},
    {"model_name": "gpt-4o-prod", "litellm_params": {"model": "azure/gpt-4o-prod", "api_key": "sk-should-never-be-written"}, "model_info": {"base_model": "azure/gpt-4o", "model_version": "2024-11-20"}},
    {"model_name": "o3-reasoning", "litellm_params": {"model": "azure/o3-team-a"}, "model_info": {"base_model": "azure/o3"}},
    {"model_name": "gemini-2.5-flash", "litellm_params": {"model": "vertex_ai/gemini-2.5-flash", "vertex_location": "global"}, "model_info": {}},
    {"model_name": "gpt-6-astra@bedrock", "litellm_params": {"model": "bedrock/converse/global.openai.gpt-6-astra"}, "model_info": {}},
    {"model_name": "internal-finetune", "litellm_params": {"model": "openai/my-custom-model", "api_base": "http://10.0.0.5"}, "model_info": {}},
]}


def _usage(prompt_tokens, completion_tokens, reasoning=0, cached=0):
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "completion_tokens_details": {"reasoning_tokens": reasoning},
        "prompt_tokens_details": {"cached_tokens": cached},
    }


def _prompt_text(messages) -> str:
    out = []
    for m in messages or []:
        c = m.get("content")
        if isinstance(c, str):
            out.append(c)
        elif isinstance(c, list):
            out += [p.get("text", "") for p in c if isinstance(p, dict)]
    return "\n".join(out)


def _has_image(messages) -> bool:
    return any(isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"]) for m in messages or [])


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    # ------------------------------------------------------------------ helpers
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._json(code, {"error": {"message": msg, "type": "invalid_request_error", "code": str(code)}})

    def _read(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    # ------------------------------------------------------------------ routes
    def do_GET(self):
        if self.path.startswith("/model/info"):
            return self._json(200, MODEL_INFO)
        if self.path.startswith("/health/readiness"):
            return self._json(200, {"status": "healthy", "litellm_version": "1.102.1-mock"})
        self._err(404, "not found")

    def do_POST(self):
        body = self._read()
        model = body.get("model", "")
        if "flaky" in model and random.random() < 0.25:
            return self._err(429, "rate limited (mock)")
        if self.path.endswith("/chat/completions"):
            return self._chat(body, model)
        if self.path.endswith("/responses"):
            return self._responses(body, model)
        if self.path.endswith("/messages"):
            return self._messages(body, model)
        self._err(404, "not found")

    def _chat(self, body, model):
        if "no-temp" in model and "temperature" in body:
            return self._err(400, "Unsupported parameter: 'temperature'")
        tc = body.get("tool_choice")
        forced = isinstance(tc, dict) or tc in ("required", "any")
        if "no-forced" in model and forced:
            return self._err(400, 'tool_choice: type "tool" and "any" are not supported for this model.')
        tools = body.get("tools") or []
        want_tool = bool(tools) and tc != "none" and not ("silent-forced" in model and forced)
        if "silent-forced" in model and forced:
            want_tool = False
        messages = body.get("messages", [])
        prompt = _prompt_text(messages)
        prompt_tokens = max(len(prompt) // 4, 1)
        cached = 0
        system = next((m.get("content") for m in messages if m.get("role") == "system" and isinstance(m.get("content"), str)), "")
        if len(system) > 4000:
            with _lock:
                if system in _seen_prefixes:
                    cached = len(system) // 4
                _seen_prefixes.add(system)
        rf = body.get("response_format") or {}
        if rf.get("type") == "json_schema" and "no-schema" not in model:
            answer = '{"country": "Japan", "capital": "Tokyo"}'
        elif _has_image(messages):
            answer = "Red"
        else:
            answer = "pong. This is a mock answer that streams a few words so that latency can be measured."
        reasoning = "Let me think about this carefully step by step." if "reasoning" in model else ""
        tool_calls = [{"id": "call_" + uuid.uuid4().hex[:8], "type": "function",
                       "function": {"name": tools[0]["function"]["name"], "arguments": json.dumps({"city": "Taipei"})}}] if want_tool else None
        completion_tokens = len(answer.split()) + (len(reasoning.split()) if reasoning else 0)
        usage = _usage(prompt_tokens, completion_tokens, len(reasoning.split()) if reasoning else 0, cached)
        cid = "chatcmpl-" + uuid.uuid4().hex[:12]
        if not body.get("stream"):
            msg = {"role": "assistant", "content": None if tool_calls else answer}
            if tool_calls:
                msg["tool_calls"] = tool_calls
            time.sleep(0.05)
            return self._json(200, {"id": cid, "object": "chat.completion", "model": model, "created": int(time.time()),
                                    "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if tool_calls else "stop"}], "usage": usage})
        # ---- streaming
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def send(obj):
            self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
            self.wfile.flush()

        base = {"id": cid, "object": "chat.completion.chunk", "model": model, "created": int(time.time())}
        time.sleep(0.05)
        for w in reasoning.split():
            send({**base, "choices": [{"index": 0, "delta": {"reasoning_content": w + " "}, "finish_reason": None}]})
            time.sleep(0.06)
        if tool_calls:
            send({**base, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, **tool_calls[0]}]}, "finish_reason": None}]})
        else:
            for w in answer.split():
                send({**base, "choices": [{"index": 0, "delta": {"content": w + " "}, "finish_reason": None}]})
                time.sleep(0.015)
        send({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if tool_calls else "stop"}]})
        if (body.get("stream_options") or {}).get("include_usage"):
            send({**base, "choices": [], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True

    def _responses(self, body, model):
        if "no-temp" in model and "temperature" in body:
            return self._err(400, "Unsupported parameter: 'temperature'")
        tools = body.get("tools") or []
        rid = "resp_" + uuid.uuid4().hex[:12]
        if tools:
            output = [{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": tools[0]["name"], "arguments": json.dumps({"city": "Taipei"})}]
        else:
            output = [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "pong"}]}]
        self._json(200, {"id": rid, "object": "response", "model": model, "status": "completed", "output": output,
                         "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}})

    def _messages(self, body, model):
        self._json(200, {"id": "msg_" + uuid.uuid4().hex[:12], "type": "message", "role": "assistant", "model": model,
                         "content": [{"type": "text", "text": "pong"}], "stop_reason": "end_turn",
                         "usage": {"input_tokens": 10, "output_tokens": 2}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4010)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"mock gateway on http://127.0.0.1:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
