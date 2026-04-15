#!/usr/bin/env python3
"""
BRAIN Corpus Backfill Script
Fetches unclassified entries, classifies via OpenRouter, writes back.
Fully resumable — restart anytime, picks up from oldest unprocessed entry.

Usage:
    export OPENROUTER_API_KEY=sk-or-...
    python3 backfill.py

Optional env vars:
    MODEL  — OpenRouter model ID (default: anthropic/claude-haiku-4-5-20251001)
    BATCH  — entries per fetch (default: 50, max: 100)
"""

import os
import json
import time
import re
import requests

# ── Configuration ──────────────────────────────────────────────────────────────
MIDDLEWARE_URL = "https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/brain-middleware"
BRAIN_KEY      = "d54c89fa2a1db9cac307909b7f59ec46a9c5cf7c79dba763ae992278f2c7abf8"

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = os.environ.get("MODEL", "anthropic/claude-haiku-4.5")
BATCH_SIZE = int(os.environ.get("BATCH", "50"))

# ── Valid taxonomy values ──────────────────────────────────────────────────────
VALID_DOMAINS   = {"ecos-architecture","tango-pedagogy","ttc-board","neil-outreach",
                   "it-consulting","music-production","brain-protocol","personal"}
VALID_HORIZONS  = {"immediate","project","evergreen"}
VALID_SIGNALS   = {"taste","voice","struct","decision","framework","content"}
VALID_CONF      = {"observed","inferred","hypothetical"}

SAFE_DEFAULTS = {"domain":"personal","horizon":"evergreen",
                 "signal_type":"content","confidence":"observed"}

# ── Prompts ────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You classify memory entries for a personal knowledge system (ECOS).

DOMAIN — pick the single most useful retrieval context:
  ecos-architecture  ECOS/BRAIN system design, Supabase, MCP, edge functions, pgvector, embeddings
  tango-pedagogy     Argentine tango instruction, ECTango, class/workshop design, milonga, technique
  ttc-board          Tucson Tango Club board governance, festival, FSP, board decisions, community politics
  neil-outreach      Neil outreach campaign, book contacts, Wave structure, MFA, publishing strategy
  it-consulting      Client tech support, networking, systems administration, IT business
  music-production   DAW, recording, mixing, arrangement, musical ideas
  brain-protocol     How to use BRAIN, retrieval patterns, capture workflows, session protocols, boot/close
  personal           Personal reflections, relationships, health, energy, identity — fallback only

HORIZON — time sensitivity:
  immediate   Time-sensitive, has a date, "this week", waiting on someone, near-term deadline
  project     Active ongoing work, no deadline pressure
  evergreen   Durable: principles, preferences, frameworks, decisions, reference — still true in a year

SIGNAL_TYPE — form of the entry (use first match in priority order):
  taste       Aesthetic preference, style constraint, "I prefer X over Y"
  voice       Tone, phrasing, communication style patterns
  decision    A committed choice was made — "we chose X", "the answer is Y"
  struct      Structural pattern, schema, organizational framework
  framework   Conceptual model, mental model, heuristic for thinking
  content     Factual, narrative, descriptive — fallback

CONFIDENCE:
  observed    Stated as fact, directly witnessed, confirmed outcome
  inferred    Reasoned from evidence, "suggests", "probably", interpretation
  hypothetical  Speculative, conditional, "if X then Y", proposals, future-oriented

Return ONLY a JSON array. No markdown, no explanation. Each object: id, domain, horizon, signal_type, confidence."""


def classify_batch(entries: list[dict]) -> list[dict]:
    """Classify a batch of entries via OpenRouter. Returns list of classification dicts."""
    entries_json = json.dumps(
        [{"id": e["id"], "content": e["content"]} for e in entries],
        indent=2
    )
    user_msg = (
        f"Classify each entry below. Return a JSON array — one object per entry "
        f"with fields: id, domain, horizon, signal_type, confidence.\n\n{entries_json}"
    )

    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ecos.local",
            "X-Title": "BRAIN Backfill",
        },
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            "temperature": 0,
        },
        timeout=120,
    )
    resp.raise_for_status()

    raw = resp.json()["choices"][0]["message"]["content"].strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    parsed = json.loads(raw)

    # Accept both a bare array and {"results": [...]} / {"classifications": [...]}
    if isinstance(parsed, list):
        return parsed
    for v in parsed.values():
        if isinstance(v, list):
            return v
    raise ValueError(f"Unexpected JSON shape from model: {list(parsed.keys())}")


def validate_and_fix(classification: dict, entry_id: str) -> dict:
    """Ensure all four fields are present and valid. Fall back to safe defaults."""
    out = {"id": entry_id}
    issues = []

    for field, valid_set, default_key in [
        ("domain",      VALID_DOMAINS,  "domain"),
        ("horizon",     VALID_HORIZONS, "horizon"),
        ("signal_type", VALID_SIGNALS,  "signal_type"),
        ("confidence",  VALID_CONF,     "confidence"),
    ]:
        val = classification.get(field, "")
        if val in valid_set:
            out[field] = val
        else:
            out[field] = SAFE_DEFAULTS[default_key]
            issues.append(f"{field}={repr(val)!r}→{out[field]}")

    if issues:
        print(f"    ⚠ {entry_id[:8]}: bad fields {issues} — defaults applied")

    return out


def fetch_with_retry(url: str, headers: dict, timeout: int = 30) -> dict:
    for attempt in range(2):
        try:
            r = requests.get(url, headers=headers, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 0:
                print(f"  Fetch error: {e}. Retrying in 10s...")
                time.sleep(10)
            else:
                raise


def main():
    if not OPENROUTER_API_KEY:
        print("ERROR: OPENROUTER_API_KEY environment variable is not set.")
        print("  export OPENROUTER_API_KEY=sk-or-...")
        return

    brain_headers = {
        "x-brain-key": BRAIN_KEY,
        "Content-Type": "application/json",
    }

    print(f"BRAIN Corpus Backfill")
    print(f"Model:      {MODEL}")
    print(f"Batch size: {BATCH_SIZE}")
    print(f"Endpoint:   {MIDDLEWARE_URL}")
    print()

    total_applied = 0
    total_errors  = []
    batch_num     = 0

    while True:
        # ── 1. Fetch next batch ────────────────────────────────────────────────
        try:
            data = fetch_with_retry(
                f"{MIDDLEWARE_URL}/backfill/next?limit={BATCH_SIZE}",
                brain_headers
            )
        except Exception as e:
            print(f"FATAL: Could not fetch batch after retry: {e}")
            break

        entries   = data.get("entries", [])
        remaining = data.get("remaining", "?")

        if not entries:
            print(f"\nDone. Total applied: {total_applied}.")
            if total_errors:
                print(f"Failed IDs ({len(total_errors)}): {total_errors}")
            break

        batch_num += 1
        print(f"Batch {batch_num:>3} — {len(entries)} entries, ~{remaining} remaining ... ", end="", flush=True)

        # ── 2. Classify ────────────────────────────────────────────────────────
        try:
            raw_classifications = classify_batch(entries)
        except Exception as e:
            print(f"CLASSIFY ERROR: {e}")
            print("  Skipping batch — will be retried on next run.")
            time.sleep(5)
            continue

        # Build an id→classification lookup
        by_id = {c.get("id"): c for c in raw_classifications if c.get("id")}

        # Validate every entry (use safe defaults for any missing from model output)
        updates = []
        for entry in entries:
            eid = entry["id"]
            raw = by_id.get(eid, {})
            updates.append(validate_and_fix(raw, eid))

        # ── 3. Apply ───────────────────────────────────────────────────────────
        try:
            r = requests.patch(
                f"{MIDDLEWARE_URL}/backfill/apply",
                headers=brain_headers,
                json={"updates": updates},
                timeout=60,
            )
            r.raise_for_status()
            result  = r.json()
            applied = result.get("applied", 0)
            errors  = result.get("errors", [])
            total_applied += applied

            if errors:
                print(f"applied={applied}, errors={len(errors)}")
                total_errors.extend(errors)
            else:
                print(f"applied={applied} ✓")
        except Exception as e:
            print(f"APPLY ERROR: {e}")

        time.sleep(1)  # be polite to the API


if __name__ == "__main__":
    main()
