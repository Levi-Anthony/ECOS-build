#!/usr/bin/env python3
"""One-shot: call ecb-mcp `reindex_artifact_embeddings` over MCP-over-HTTP.

Use after the Artifact v2 migration to embed migrated /body blocks so
search_artifacts finds them. Keeps the key in your shell (off any transcript).

  ECB_URL=https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp \
  ECB_KEY=<prod MCP_ACCESS_KEY> \
  python3 scripts/ecb-reindex-embeddings.py            # sweep all (limit 500)
  # optional: --key <artifact_key>   --path </block>   --limit N

Reuses the handshake from scripts/ecb-drift-check.py. Exit 0 ok / 1 error.
"""
import argparse, json, os, sys, urllib.request, urllib.error

URL = os.environ.get("ECB_URL", "https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp")
KEY = os.environ.get("ECB_KEY")
_sid = {"v": None}
_n = [0]

def _parse(body, ctype):
    if "text/event-stream" in (ctype or ""):
        out = None
        for line in body.splitlines():
            if line.startswith("data:"):
                out = json.loads(line[5:].strip())
        return out
    return json.loads(body) if body.strip() else None

def rpc(method, params=None, notify=False):
    _n[0] += 1
    p = {"jsonrpc": "2.0", "method": method}
    if not notify:
        p["id"] = _n[0]
    if params is not None:
        p["params"] = params
    h = {"Content-Type": "application/json",
         "Accept": "application/json, text/event-stream", "x-brain-key": KEY}
    if _sid["v"]:
        h["mcp-session-id"] = _sid["v"]
    req = urllib.request.Request(URL, data=json.dumps(p).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        if r.headers.get("mcp-session-id"):
            _sid["v"] = r.headers["mcp-session-id"]
        return _parse(r.read().decode(), r.headers.get("Content-Type"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key")
    ap.add_argument("--path")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    if not KEY:
        print("ERROR: set ECB_KEY (prod MCP_ACCESS_KEY)", file=sys.stderr); sys.exit(1)
    try:
        init = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                  "clientInfo": {"name": "reindex", "version": "1"}})
        if not init or "result" not in init:
            print("ERROR: endpoint did not initialize", file=sys.stderr); sys.exit(1)
        rpc("notifications/initialized", notify=True)
        a = {}
        if args.key:   a["key"] = args.key
        if args.path:  a["path"] = args.path
        if args.limit: a["limit"] = args.limit
        # Loop converging batches until the tool reports nothing remaining (or no key/path scope).
        for _ in range(200):
            res = rpc("tools/call", {"name": "reindex_artifact_embeddings", "arguments": a})
            if not res or "result" not in res:
                # Empty SSE body almost always means a server-side timeout — shrink the batch.
                print("ERROR: empty/no response from server (likely a server-side timeout — "
                      "re-run with a smaller --limit, e.g. --limit 10).", file=sys.stderr)
                sys.exit(1)
            result = res["result"]
            text = "".join(c.get("text", "") for c in result.get("content", []))
            print(text or json.dumps(res, indent=2))
            if result.get("isError"):
                sys.exit(1)
            if args.key or args.path or "still missing" not in text:
                break  # scoped call, or sweep is complete
        sys.exit(0)
    except urllib.error.HTTPError as e:
        print(f"ERROR: HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
