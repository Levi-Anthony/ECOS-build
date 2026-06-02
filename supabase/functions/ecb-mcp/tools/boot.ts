// Boot tools — ECBRAIN V1 bundled context retrieval.
// Phase 3: get_boot_context implemented.
//
// Tools registered here:
//   get_boot_context  (read, READ_ONLY)
//
// boot_artifacts filter: artifacts WHERE metadata->'tags' @> '["boot"]' (Artifact v2)
//   — v3.2 correction: no metadata column; tags array is the mechanism.
//   Add the 'boot' tag to any artifact that should appear at boot.
//
// derived_orientation: computed inline from latest snapshot + recent pulses.
//   V1: mode/focus from typed pulses; open_loops/highest_leverage from snapshot text.
//   V1.5: promote to server-side parsing if the inline logic grows complex.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY } from "../lib/annotations.ts";
import { textResult, errorResult } from "../lib/format.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnapshotRow {
  id: string;
  compiled_at: string;
  compiled_by: string;
  source_session_id: string | null;
  watermark_event_seq: number;
  watermark_occurred_at: string | null;
  content: string;
  metadata: Record<string, unknown>;
  is_current: boolean;
  artifact_id: string | null;
}

interface PulseRow {
  id: string;
  session_id: string;
  surface: string;
  pulse_type: string;
  content: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

// Raw v2 artifacts row (boot-tagged via metadata.tags). Legacy fields
// (authority_level/scope/target_runtime/summary/tags) live in metadata after
// the artifacts-v2 migration and are flattened into the boot payload below.
interface ArtifactRow {
  id: string;
  key: string;
  title: string;
  kind: string;
  current_version: number;
  metadata: Record<string, unknown>;
  updated_at: string;
}

// ─── Inline orientation derivation ───────────────────────────────────────────

function deriveOrientation(
  snapshot: SnapshotRow | null,
  recentPulses: PulseRow[],
) {
  // Mode and focus from the most recent typed pulse entries.
  // Clients write pulse_type='mode' or pulse_type='focus' to drive these fields.
  const modePulse  = recentPulses.find(p => p.pulse_type === "mode");
  const focusPulse = recentPulses.find(p => p.pulse_type === "focus");

  // V1: open_loops, highest_leverage, constraints are parsed from the snapshot
  // content text by simple line-prefix heuristics. Returns empty/null when
  // no snapshot exists. Promote to structured parsing in V1.5 if needed.
  const openLoops: string[] = [];
  let highestLeverage: string | null = null;
  let constraints: string | null = null;

  if (snapshot?.content) {
    const lines = snapshot.content.split("\n");
    let inOpenLoops = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // Section detection (HANDOFF.md conventions)
      if (/^#+\s*(open loops|open_loops)/i.test(trimmed)) {
        inOpenLoops = true;
        continue;
      }
      if (/^#+/.test(trimmed) && inOpenLoops) {
        inOpenLoops = false;
      }
      if (inOpenLoops && trimmed.startsWith("- ")) {
        openLoops.push(trimmed.slice(2));
      }
      // Highest-leverage: look for "highest leverage:" or "next action:" lines
      if (/highest.leverage[:\s]/i.test(trimmed) && !highestLeverage) {
        highestLeverage = trimmed.replace(/^.*highest.leverage[:\s]*/i, "").trim() || null;
      }
      // Constraints
      if (/^constraints?[:\s]/i.test(trimmed) && !constraints) {
        constraints = trimmed.replace(/^constraints?[:\s]*/i, "").trim() || null;
      }
    }
  }

  const contentMd = snapshot
    ? snapshot.content
    : "(no handoff snapshot — cold start; boot from BRAIN search)";

  return {
    mode:              modePulse?.content  ?? null,
    focus:             focusPulse?.content ?? null,
    open_loops:        openLoops,
    highest_leverage:  highestLeverage,
    constraints:       constraints,
    content_md:        contentMd,
  };
}

// ─── Tool registration ────────────────────────────────────────────────────────

export const register: RegisterFn = (registrar, supabase, _helpers) => {

  registrar.registerTool(
    "get_boot_context",
    {
      title: "Get Boot Context",
      description:
        "Bundled read returning everything needed to boot a desktop or mobile session: " +
        "latest handoff snapshot, recent pulse entries (last 20), derived orientation, " +
        "boot artifacts (v2 artifacts tagged 'boot'), and server time. " +
        "Any sub-fetch failure degrades that field to null/[] but the call still succeeds. " +
        "Client decides what is enough to boot.",
      inputSchema: {
        surface:    z.string().describe("Calling surface: desktop | mobile | shortcut | cron"),
        session_id: z.string().optional().describe("New session UUID — used to scope pulse since filter"),
        since:      z.string().optional().describe("ISO timestamp — only pulses at or after this time"),
      },
      annotations: READ_ONLY,
    },
    async ({ surface: _surface, session_id: _session_id, since }) => {
      const degraded: Record<string, unknown> = {};

      // ── 1. Latest handoff snapshot ─────────────────────────────────────────
      let snapshot: SnapshotRow | null = null;
      try {
        const { data, error } = await supabase
          .from("handoff_snapshots")
          .select(
            "id, compiled_at, compiled_by, source_session_id, watermark_event_seq, " +
            "watermark_occurred_at, content, metadata, is_current, artifact_id"
          )
          .eq("is_current", true)
          .maybeSingle();

        if (error) {
          degraded.snapshot_error = error.message;
        } else {
          snapshot = data as SnapshotRow | null;
          if (snapshot) {
            const ageMs = Date.now() - new Date(snapshot.compiled_at).getTime();
            degraded.snapshot_age_s = Math.round(ageMs / 1000);
          }
        }
      } catch (err: unknown) {
        degraded.snapshot_error = (err as Error).message;
      }

      // ── 2. Recent pulse entries ────────────────────────────────────────────
      let recentPulse: PulseRow[] = [];
      try {
        let q = supabase
          .from("pulse_entries")
          .select("id, session_id, surface, pulse_type, content, metadata, occurred_at")
          .order("occurred_at", { ascending: false })
          .limit(20);

        if (since) q = q.gte("occurred_at", since);

        const { data, error } = await q;
        if (error) {
          degraded.pulse_error = error.message;
        } else {
          recentPulse = (data ?? []) as PulseRow[];
        }
      } catch (err: unknown) {
        degraded.pulse_error = (err as Error).message;
      }

      // ── 3. Boot artifacts ──────────────────────────────────────────────────
      // Artifact v2: boot docs live in `artifacts` with metadata.tags including
      // 'boot'. Add the 'boot' tag (in metadata) to any artifact that should
      // appear at boot. Legacy fields are flattened from metadata for the payload.
      let bootArtifacts: Record<string, unknown>[] = [];
      try {
        const { data, error } = await supabase
          .from("artifacts")
          .select("id, key, title, kind, current_version, metadata, updated_at")
          .contains("metadata", { tags: ["boot"] }) // metadata @> '{"tags":["boot"]}'
          .order("updated_at", { ascending: false });

        if (error) {
          degraded.boot_artifacts_error = error.message;
        } else {
          bootArtifacts = ((data ?? []) as ArtifactRow[]).map((a) => {
            const m = (a.metadata ?? {}) as Record<string, unknown>;
            return {
              id: a.id, key: a.key, title: a.title, kind: a.kind, version: a.current_version,
              authority_level: m.authority_level ?? null,
              scope: m.scope ?? null,
              target_runtime: m.target_runtime ?? null,
              summary: m.summary ?? null,
              tags: m.tags ?? [],
              updated_at: a.updated_at,
            };
          });
        }
      } catch (err: unknown) {
        degraded.boot_artifacts_error = (err as Error).message;
      }

      // ── 4. Derived orientation (inline, V1) ────────────────────────────────
      const derivedOrientation = deriveOrientation(snapshot, recentPulse);

      // ── 5. Handoff event lag count since watermark ─────────────────────────
      if (snapshot) {
        try {
          const { count } = await supabase
            .from("handoff_events")
            .select("id", { count: "exact", head: true })
            .gt("event_seq", snapshot.watermark_event_seq);

          if (count !== null) degraded.recent_event_count = count;
        } catch {
          // non-blocking
        }
      }

      // ── Bundle ─────────────────────────────────────────────────────────────
      const payload = {
        handoff_snapshot:    snapshot,
        recent_pulse:        recentPulse,
        derived_orientation: derivedOrientation,
        boot_artifacts:      bootArtifacts,
        server_time:         new Date().toISOString(),
        degraded_hints:      Object.keys(degraded).length > 0 ? degraded : null,
      };

      return textResult(JSON.stringify(payload, null, 2));
    }
  );

};
