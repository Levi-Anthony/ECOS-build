#!/usr/bin/env python3
"""Import one local Markdown file into ECB as an exact /body artifact.

Requires ECB_KEY in the environment. ECB_URL defaults to production ecb-mcp.
This script never prints the document body or any secret value.

Example:
  ECB_KEY=<brain key> python3 scripts/ecb-import-markdown-doc.py \
    --file docs/people-intel-prompts.md \
    --key people-intelligence-prompts \
    --title "People-Intelligence Prompts" \
    --kind prompt \
    --canonical-source ECB \
    --repo-role export
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp"


def parse_event_stream(body):
    out = None
    for line in body.splitlines():
        if line.startswith("data:"):
            out = json.loads(line[5:].strip())
    return out


class McpClient:
    def __init__(self, url, key):
        self.url = url
        self.key = key
        self.session_id = None
        self.request_id = 0

    def rpc(self, method, params=None, notify=False):
        self.request_id += 1
        payload = {"jsonrpc": "2.0", "method": method}
        if not notify:
            payload["id"] = self.request_id
        if params is not None:
            payload["params"] = params

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "x-brain-key": self.key,
        }
        if self.session_id:
            headers["mcp-session-id"] = self.session_id

        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            if response.headers.get("mcp-session-id"):
                self.session_id = response.headers["mcp-session-id"]
            text = response.read().decode()
            content_type = response.headers.get("Content-Type", "")

        if "text/event-stream" in content_type:
            return parse_event_stream(text)
        return json.loads(text) if text.strip() else None

    def initialize(self):
        self.rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "ecb-import-markdown-doc", "version": "1"},
            },
        )
        self.rpc("notifications/initialized", notify=True)

    def call_tool(self, name, arguments):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if not result or "result" not in result:
            raise RuntimeError(f"{name}: malformed response")
        tool_result = result["result"]
        text = "".join(part.get("text", "") for part in tool_result.get("content", []))
        if tool_result.get("isError"):
            raise RuntimeError(text.strip() or f"{name}: tool error")
        return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="Markdown file to import")
    parser.add_argument("--key", required=True, help="Stable ECB artifact key")
    parser.add_argument("--title", required=True, help="ECB artifact title")
    parser.add_argument("--kind", default="document", help="Artifact kind")
    parser.add_argument(
        "--canonical-source",
        choices=["ECB", "GitHub", "mixed"],
        required=True,
        help="Authority class for the imported content",
    )
    parser.add_argument(
        "--repo-role",
        default="working_copy",
        choices=[
            "pointer",
            "mirror",
            "export",
            "working_copy",
            "implementation_reference",
            "operator_copy",
        ],
        help="Role of the repo file after import",
    )
    parser.add_argument("--source-repo", default=str(Path.cwd()))
    parser.add_argument("--tag", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 1
    if path.suffix.lower() != ".md":
        print(f"ERROR: expected a Markdown file: {path}", file=sys.stderr)
        return 1

    body = path.read_text(encoding="utf-8")
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    metadata = {
        "source_file": str(path),
        "source_repo": args.source_repo,
        "canonical_source": args.canonical_source,
        "repo_role": args.repo_role,
        "imported_by": "scripts/ecb-import-markdown-doc.py",
        "source_sha256": digest,
        "tags": args.tag,
    }

    payload = {
        "key": args.key,
        "title": args.title,
        "kind": args.kind,
        "create_snapshot": True,
        "metadata": metadata,
        "blocks": [
            {
                "path": "/body",
                "title": "Body",
                "content": body,
                "sort_order": 0,
                "metadata": {
                    "source_file": str(path),
                    "source_sha256": digest,
                    "exact_markdown_import": True,
                },
            }
        ],
    }

    print(f"Import target: {args.key}")
    print(f"Source file  : {path}")
    print(f"Body bytes   : {len(body.encode('utf-8'))}")
    print(f"SHA-256      : {digest}")
    if args.dry_run:
        print("Dry run only; no ECB write attempted.")
        return 0

    key = os.environ.get("ECB_KEY")
    if not key:
        print("ERROR: set ECB_KEY in the environment", file=sys.stderr)
        return 1

    url = os.environ.get("ECB_URL", DEFAULT_URL)
    client = McpClient(url, key)
    try:
        client.initialize()
        result = client.call_tool("create_artifact", payload)
    except urllib.error.HTTPError as exc:
        print(f"ERROR: HTTP {exc.code}: {exc.read().decode()[:300]}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(result.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
