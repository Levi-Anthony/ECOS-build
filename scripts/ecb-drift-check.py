#!/usr/bin/env python3
"""ecb-mcp deploy↔git drift check (READ-ONLY, report-only — never mutates).

Seeded 2026-06-01 after the git↔deploy fork incident (see DEPLOY.md "Deploy
discipline" and BRAIN handoff event ecb-reconcile-2026-06-01-deployrule).

What it catches: the exact failure that bit us — the set of tools the LIVE
function exposes drifting from the set the canonical deploy branch registers.

Compares three numbers that must all agree:
  1. live tool count   — tools/list against the deployed MCP endpoint
  2. git tool count    — registerTool names in the deploy branch's tools/*.ts
  3. EXPECTED_TOOL_COUNT — the assertion constant in the branch's index.ts

And the two NAME SETS (live vs git), reporting DEPLOYED-only / GIT-only.

Usage:
  ECB_KEY=<brain key> python3 scripts/ecb-drift-check.py [--branch restore/deploy-canonical]

Exit codes: 0 = in sync · 2 = drift detected · 1 = error reaching endpoint/git.
"""
import argparse, json, os, re, subprocess, sys, urllib.request, urllib.error

URL = os.environ.get("ECB_URL", "https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp")
FN_DIR = "supabase/functions/ecb-mcp"

def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)

# ---- live side: MCP handshake + tools/list -------------------------------
def _parse(body, ctype):
    if "text/event-stream" in (ctype or ""):
        out = None
        for line in body.splitlines():
            if line.startswith("data:"):
                out = json.loads(line[5:].strip())
        return out
    return json.loads(body) if body.strip() else None

def live_tool_names(key):
    sid = {"v": None}
    n = [0]
    def rpc(method, params=None, notify=False):
        n[0] += 1
        p = {"jsonrpc": "2.0", "method": method}
        if not notify:
            p["id"] = n[0]
        if params is not None:
            p["params"] = params
        h = {"Content-Type": "application/json",
             "Accept": "application/json, text/event-stream", "x-brain-key": key}
        if sid["v"]:
            h["mcp-session-id"] = sid["v"]
        req = urllib.request.Request(URL, data=json.dumps(p).encode(), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.headers.get("mcp-session-id"):
                sid["v"] = r.headers["mcp-session-id"]
            return _parse(r.read().decode(), r.headers.get("Content-Type"))
    try:
        init = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                  "clientInfo": {"name": "drift-check", "version": "1"}})
        if not init or "result" not in init:
            die("endpoint did not initialize (500 on boot? count assertion may have thrown)")
        rpc("notifications/initialized", notify=True)
        res = rpc("tools/list")
        return sorted(t["name"] for t in res["result"]["tools"])
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code} from endpoint: {e.read().decode()[:200]}")

# ---- git side: registered names + EXPECTED_TOOL_COUNT on a branch ---------
def git_show(branch, path):
    r = subprocess.run(["git", "show", f"{branch}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def git_tool_names(branch):
    files = subprocess.run(["git", "ls-tree", "-r", "--name-only", branch, "--", f"{FN_DIR}"],
                           capture_output=True, text=True).stdout.splitlines()
    ts = [f for f in files if f.endswith(".ts")]
    names = set()
    pat = re.compile(r'registerTool\(\s*"([a-z_]+)"', re.S)
    for f in ts:
        src = git_show(branch, f) or ""
        names.update(pat.findall(src))
    return sorted(names)

def git_expected_count(branch):
    idx = git_show(branch, f"{FN_DIR}/index.ts") or ""
    m = re.search(r"EXPECTED_TOOL_COUNT\s*=\s*(\d+)", idx)
    return int(m.group(1)) if m else None

# ---- compare -------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", default="restore/deploy-canonical")
    args = ap.parse_args()
    key = os.environ.get("ECB_KEY") or die("set ECB_KEY (the brain access key)")

    live = live_tool_names(key)
    git = git_tool_names(args.branch)
    expected = git_expected_count(args.branch)

    live_set, git_set = set(live), set(git)
    dep_only = sorted(live_set - git_set)
    git_only = sorted(git_set - live_set)

    print(f"deploy branch     : {args.branch}")
    print(f"live tool count   : {len(live)}")
    print(f"git tool count    : {len(git)}")
    print(f"EXPECTED_TOOL_COUNT (branch index.ts): {expected}")

    drift = False
    if len(live) != len(git):
        drift = True
        print(f"\nDRIFT: live count ({len(live)}) != git count ({len(git)})")
    if expected is not None and expected != len(git):
        drift = True
        print(f"\nDRIFT: EXPECTED_TOOL_COUNT ({expected}) != git registrations ({len(git)})")
    if dep_only:
        drift = True
        print(f"\nDEPLOYED-only (live has, branch lacks) [{len(dep_only)}]: {', '.join(dep_only)}")
    if git_only:
        drift = True
        print(f"\nGIT-only (branch has, live lacks) [{len(git_only)}]: {', '.join(git_only)}")

    if drift:
        print("\n=> DRIFT DETECTED. Reconcile before deploying. (report-only; nothing changed)")
        sys.exit(2)
    print("\n=> IN SYNC. live == git == EXPECTED_TOOL_COUNT, name sets identical.")
    sys.exit(0)

if __name__ == "__main__":
    main()
