#!/usr/bin/env python3
"""Artifact v2 acceptance/verification harness — drives the deployed ecb-mcp over
MCP-over-HTTP and runs the 10 acceptance tests from the Artifact v2 spec.

This MUTATES data (it creates one uniquely-keyed test artifact, e.g.
`v2_verify_<epoch>`), so point it at STAGING, not prod, until v2 is approved.
It never deletes — the test artifact is left behind, clearly keyed.

  ECB_URL=https://<project>.supabase.co/functions/v1/ecb-mcp \
  ECB_KEY=<brain key> \
  python3 scripts/ecb-artifacts-v2-verify.py

Exit: 0 = all pass (skips allowed) · 2 = a test failed · 1 = transport error.
Reuses the handshake/_parse pattern from scripts/ecb-drift-check.py.
"""
import json, os, re, sys, time, urllib.request, urllib.error

URL = os.environ.get("ECB_URL", "https://gfqumzumfdeeojuwwvbu.supabase.co/functions/v1/ecb-mcp")  # default: staging
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
    with urllib.request.urlopen(req, timeout=120) as r:
        if r.headers.get("mcp-session-id"):
            _sid["v"] = r.headers["mcp-session-id"]
        return _parse(r.read().decode(), r.headers.get("Content-Type"))

def call(tool, args):
    """Return (text, is_error)."""
    res = rpc("tools/call", {"name": tool, "arguments": args})
    if not res or "result" not in res:
        raise RuntimeError(f"{tool}: bad response {res}")
    result = res["result"]
    text = "".join(c.get("text", "") for c in result.get("content", []))
    return text, bool(result.get("isError"))

# ---- tiny test harness ----
PASS, FAIL, SKIP = [], [], []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))
    return cond
def skip(name, why):
    SKIP.append(name); print(f"  [SKIP] {name} — {why}")

def main():
    if not KEY:
        print("ERROR: set ECB_KEY", file=sys.stderr); sys.exit(1)
    try:
        init = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                  "clientInfo": {"name": "v2-verify", "version": "1"}})
        if not init or "result" not in init:
            print("ERROR: endpoint did not initialize (boot assertion may have thrown)", file=sys.stderr); sys.exit(1)
        rpc("notifications/initialized", notify=True)
    except urllib.error.HTTPError as e:
        print(f"ERROR: HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr); sys.exit(1)

    key = f"v2_verify_{int(time.time())}"
    print(f"Artifact v2 verification against {URL}\n  test key: {key}\n")

    # 1. create with 3 blocks → v1
    text, err = call("create_artifact", {"key": key, "title": "V2 Verify", "kind": "strategy_tracker",
        "blocks": [
            {"path": "/overview", "title": "Overview", "content": "Verification artifact.", "sort_order": 0},
            {"path": "/current_state", "title": "Current State", "content": "Initial current state line.", "sort_order": 1},
            {"path": "/decision_log", "title": "Decision Log", "content": "2026-06-02 — created.", "sort_order": 2},
        ]})
    check("1 create_artifact (3 blocks, v1)", (not err) and "version 1" in text and "3 block" in text, text)

    # 2. manifest has paths/hashes/versions, no giant body
    text, err = call("get_artifact_manifest", {"key": key})
    man = json.loads(text) if not err else {}
    paths = {b["path"]: b for b in man.get("blocks", [])}
    check("2 manifest (paths+hashes+version, no content)",
          (not err) and man.get("current_version") == 1
          and {"/overview", "/current_state", "/decision_log"} <= set(paths)
          and all("hash" in b and "content" not in b for b in man.get("blocks", [])), text[:200])

    # 3. block read exact content + hash
    text, err = call("get_artifact_block", {"key": key, "paths": ["/current_state"]})
    blk = json.loads(text)["blocks"][0] if not err else {}
    cs_hash = blk.get("content_hash")
    check("3 block read (exact content + hash)",
          (not err) and blk.get("content") == "Initial current state line." and bool(cs_hash), text[:200])

    # 4. safe patch → v2, only that block changes
    text, err = call("patch_artifact", {"key": key, "base_version": 1, "summary": "update current state",
        "ops": [{"op": "replace_block", "path": "/current_state", "expected_hash": cs_hash,
                 "content": "Updated current state 2026-06-02 with unique-token ZEBRAFINCH."}]})
    pres = json.loads(text) if not err else {}
    check("4 safe patch (v1→v2, changed_paths=/current_state)",
          (not err) and pres.get("new_version") == 2 and pres.get("changed_paths") == ["/current_state"], text[:200])

    # 5. stale base_version rejected
    text, err = call("patch_artifact", {"key": key, "base_version": 1, "summary": "stale",
        "ops": [{"op": "replace_block", "path": "/overview", "content": "should not apply"}]})
    check("5 stale base_version rejected", err and "version" in text.lower(), text[:200])
    text2, _ = call("get_artifact_manifest", {"key": key})
    check("5b no write on stale reject (still v2)", json.loads(text2).get("current_version") == 2, text2[:120])

    # 6. hash mismatch rejected
    text, err = call("patch_artifact", {"key": key, "base_version": 2, "summary": "bad hash",
        "ops": [{"op": "replace_block", "path": "/current_state", "expected_hash": "deadbeef", "content": "nope"}]})
    check("6 hash mismatch rejected", err and "hash" in text.lower(), text[:200])

    # 7. append log preserves + appends, bumps version
    text, err = call("patch_artifact", {"key": key, "base_version": 2, "summary": "append decision",
        "ops": [{"op": "append_block", "path": "/decision_log", "content": "2026-06-02 — appended decision."}]})
    pres = json.loads(text) if not err else {}
    text2, _ = call("get_artifact_block", {"key": key, "paths": ["/decision_log"]})
    dl = json.loads(text2)["blocks"][0]["content"]
    check("7 append (old preserved + appended, v→3)",
          (not err) and pres.get("new_version") == 3 and "created." in dl and "appended decision." in dl, dl[:200])

    # 8. checkpoint creates snapshot
    text, err = call("checkpoint_artifact", {"key": key})
    check("8 checkpoint (snapshot at current version)", (not err) and "Snapshot created" in text and "version 3" in text, text[:200])
    text2, err2 = call("get_artifact_snapshot", {"key": key})
    check("8b snapshot includes all active blocks", (not err2) and "Current State" in text2 and "Decision Log" in text2, text2[:120])

    # 9. block-level search returns key + path (give embeddings a moment)
    time.sleep(2)
    text, err = call("search_artifacts", {"query": "ZEBRAFINCH unique token current state", "key": key, "threshold": 0.2})
    # Block-scoped result: returns the artifact key + a block path + per-block excerpts
    # (not a single dumped full document). Asserted positively rather than by a fragile
    # "sibling block absent" check, which the low threshold would make flaky.
    check("9 block search returns key + block path (block-scoped excerpts)",
          (not err) and key in text and "/current_state" in text and "Block:" in text, text[:300])

    # 10. migration safety (only if a migrated artifact exists on this DB)
    text, err = call("list_artifacts", {"limit": 100})
    migrated_key = None
    if not err:
        # find a migrated artifact by inspecting manifests for metadata.migrated_from
        for m in re.findall(r"key:\s*([^\s]+)", text):
            if m == key:
                continue
            mt, me = call("get_artifact_manifest", {"key": m})
            if not me and json.loads(mt).get("metadata", {}).get("migrated_from") == "canonical_artifacts":
                migrated_key = m; break
    if migrated_key:
        mt, _ = call("get_artifact_manifest", {"key": migrated_key})
        man = json.loads(mt)
        has_body = any(b["path"] == "/body" for b in man.get("blocks", []))
        snap, serr = call("get_artifact_snapshot", {"key": migrated_key, "version": 1})
        check("10 migration safety (/body block + v1 snapshot preserved)", has_body and not serr, migrated_key)
    else:
        skip("10 migration safety", "no migrated canonical_artifacts on this DB (fresh staging?)")

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed, {len(SKIP)} skipped.")
    sys.exit(2 if FAIL else 0)

if __name__ == "__main__":
    main()
