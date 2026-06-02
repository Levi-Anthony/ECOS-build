#!/usr/bin/env python3
"""ecb-mcp migration drift check (READ-ONLY) — applied DB migrations vs committed repo.

Detects recurrence of the git<->ECB *schema* drift: migrations applied to the live
database (via apply_migration / direct) that were never committed to
supabase/migrations/. Sibling to scripts/ecb-drift-check.py (which does the tool surface).

Two directions:
  APPLIED-NOT-IN-REPO (red)  : the live DB has a migration the repo lacks -> the drift that bit us.
  REPO-NOT-APPLIED    (info) : the repo has a migration not yet applied to this DB (normal pending,
                               e.g. the 00000000000000 prelude that prod never applied out-of-band).

Applied versions are read via the Supabase Management API — no DB password, and an
EXPLICIT --project-ref so it never depends on the local CLI link cache (which was found
inconsistent: linked-project.json said prod while everything else said staging).

  SUPABASE_ACCESS_TOKEN=...  python3 scripts/ecb-migration-drift.py [--project-ref REF]
  (create a token at https://supabase.com/dashboard/account/tokens)

Offline / CI / testing:  --applied-from FILE   (newline list, or a JSON array, of versions)

Exit: 0 in-sync (no applied-not-in-repo) · 2 drift (applied-not-in-repo > 0) · 1 error.
"""
import argparse, json, os, re, sys, urllib.request, urllib.error

PROD = "lqbrzoicorehwidkdhoi"
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "supabase", "migrations")
QUERY = "select version from supabase_migrations.schema_migrations order by version;"

def fetch_via_api(ref, token):
    url = f"https://api.supabase.com/v1/projects/{ref}/database/query"
    req = urllib.request.Request(url, data=json.dumps({"query": QUERY}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    rows = data if isinstance(data, list) else data.get("result") or data.get("rows") or []
    return [str(row["version"]) for row in rows]

def read_file(path):
    txt = open(path).read().strip()
    return [str(v) for v in json.loads(txt)] if txt.startswith("[") else [l.strip() for l in txt.splitlines() if l.strip()]

def local_versions(d):
    return [m.group(1) for fn in os.listdir(d) if (m := re.match(r"^(\d+)_.*\.sql$", fn))]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-ref", default=PROD)
    ap.add_argument("--migrations-dir", default=DEFAULT_DIR)
    ap.add_argument("--applied-from", help="read applied versions from a file instead of the API")
    ap.add_argument("--token", default=os.environ.get("SUPABASE_ACCESS_TOKEN"))
    a = ap.parse_args()

    if a.applied_from:
        applied, src = read_file(a.applied_from), f"file:{os.path.basename(a.applied_from)}"
    else:
        if not a.token:
            sys.exit("ERROR: set SUPABASE_ACCESS_TOKEN (or --token), or pass --applied-from.")
        try:
            applied, src = fetch_via_api(a.project_ref, a.token), f"api:{a.project_ref}"
        except urllib.error.HTTPError as e:
            sys.exit(f"ERROR: Management API {e.code}: {e.read().decode()[:200]}")
        except urllib.error.URLError as e:
            sys.exit(f"ERROR: cannot reach Management API: {e}")

    A, R = set(applied), set(local_versions(a.migrations_dir))
    applied_not_repo = sorted(A - R)
    repo_not_applied = sorted(R - A)

    print(f"applied ({src}): {len(A)}    repo ({a.migrations_dir}): {len(R)}")
    if applied_not_repo:
        print(f"\nAPPLIED-NOT-IN-REPO [{len(applied_not_repo)}] - live migrations missing from git (DRIFT):")
        for v in applied_not_repo: print(f"   {v}")
    if repo_not_applied:
        print(f"\nREPO-NOT-APPLIED [{len(repo_not_applied)}] - committed but not applied to this DB (pending; normal):")
        for v in repo_not_applied: print(f"   {v}")

    if applied_not_repo:
        print("\n=> DRIFT. Export the above from schema_migrations.statements and commit them. (report-only; nothing changed)")
        sys.exit(2)
    print("\n=> IN SYNC on the critical axis: every applied migration is committed." +
          (" (pending repo migrations are expected.)" if repo_not_applied else ""))
    sys.exit(0)

if __name__ == "__main__":
    main()
