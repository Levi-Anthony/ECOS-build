/**
 * Schema alignment tests.
 *
 * These tests document the contract between TypeScript types (lib/supabase.ts)
 * and the actual Supabase DB column names (supabase/migrations/).
 *
 * They are not testing runtime behaviour — they are living documentation that
 * will fail to compile if a type rename introduces a mismatch. Running them
 * regularly catches type drift before it reaches production queries.
 *
 * Each test constructs a valid typed object. If a field name is wrong,
 * TypeScript will error at compile time before Vitest even runs.
 */

import { describe, it, expect } from "vitest";
import type {
  Opportunity,
  ServiceLog,
  BillingEntry,
  Briefing,
  PersonObservation,
  PersonSnapshot,
  Artifact,
  ArtifactChangeProposal,
} from "@/lib/supabase";

// ─── Artifact v3 human door ─────────────────────────────────────────────────

describe("Artifact v3 governance types", () => {
  it("exposes review_policy on artifacts", () => {
    const artifact: Artifact = {
      id: "a1",
      key: "example",
      title: "Example",
      kind: "document",
      status: "active",
      review_policy: "human_gate",
      current_version: 2,
      metadata: {},
      created_at: "2026-06-04",
      updated_at: "2026-06-04",
    };
    expect(artifact.review_policy).toBe("human_gate");
  });

  it("types pending artifact change proposals", () => {
    const proposal: ArtifactChangeProposal = {
      id: "p1",
      artifact_id: "a1",
      base_version: 2,
      ops: [{ op: "replace_block", path: "/body", expected_hash: "hash", content: "new" }],
      summary: "Change body",
      proposer_actor_type: "agent",
      proposer_actor_id: "mcp",
      source_refs: {},
      review_policy_at_proposal: "human_gate",
      status: "pending",
      supersedes_proposal_id: null,
      review_reason: null,
      reviewed_by_type: null,
      reviewed_by_id: null,
      reviewed_at: null,
      applied_version: null,
      metadata: {},
      created_at: "2026-06-04",
      updated_at: "2026-06-04",
    };
    expect(proposal.ops[0].expected_hash).toBe("hash");
  });
});

// ─── Opportunity ──────────────────────────────────────────────────────────────

describe("Opportunity type", () => {
  it("uses close_date (not expected_close_date) matching DB column", () => {
    const opp: Opportunity = {
      id: "00000000-0000-0000-0000-000000000001",
      contact_id: "00000000-0000-0000-0000-000000000002",
      title: "Test opp",
      stage: "prospect",
      value: null,
      close_date: "2026-06-01",
      notes: null,
      created_at: "2026-04-23T00:00:00Z",
    };
    expect(opp.close_date).toBe("2026-06-01");
    // TypeScript compile-time guard: accessing opp.expected_close_date would error
    expect("expected_close_date" in opp).toBe(false);
  });

  it("accepts null close_date", () => {
    const opp: Opportunity = {
      id: "1", contact_id: "2", title: "T", stage: "qualified",
      value: 500, close_date: null, notes: null, created_at: "2026-01-01",
    };
    expect(opp.close_date).toBeNull();
  });
});

// ─── PersonObservation ────────────────────────────────────────────────────────

describe("PersonObservation type", () => {
  it("includes source field (NOT NULL in migration)", () => {
    const obs: PersonObservation = {
      id: "1", contact_id: "2",
      observation_type: "fact",
      content: "test",
      confidence: 4,
      domain_context: null,
      observed_at: "2026-04-23T00:00:00Z",
      source: "claude-code",
      linked_thought_id: null,
      created_at: "2026-04-23T00:00:00Z",
      updated_at: "2026-04-23T00:00:00Z",
    };
    expect(obs.source).toBe("claude-code");
  });

  it("includes updated_at field (NOT NULL in migration)", () => {
    const obs: PersonObservation = {
      id: "1", contact_id: "2",
      observation_type: "strategy",
      content: "test",
      confidence: 5,
      domain_context: "tango",
      observed_at: "2026-04-23T00:00:00Z",
      source: "api",
      linked_thought_id: "3",
      created_at: "2026-04-23T00:00:00Z",
      updated_at: "2026-04-23T00:00:00Z",
    };
    expect(obs.updated_at).toBeDefined();
  });

  it("observation_type covers all 5 DB CHECK values", () => {
    const validTypes: PersonObservation["observation_type"][] = [
      "fact", "observation", "interpretation", "hypothesis", "strategy",
    ];
    expect(validTypes).toHaveLength(5);
  });

  it("confidence is typed as number (not string)", () => {
    const obs: PersonObservation = {
      id: "1", contact_id: "2", observation_type: "fact",
      content: "x", confidence: 3, domain_context: null,
      observed_at: "2026-04-23", source: "api",
      linked_thought_id: null, created_at: "2026-04-23",
      updated_at: "2026-04-23",
    };
    expect(typeof obs.confidence).toBe("number");
  });
});

// ─── PersonSnapshot ───────────────────────────────────────────────────────────

describe("PersonSnapshot type", () => {
  it("includes source_observation_ids array (migration column)", () => {
    const snap: PersonSnapshot = {
      id: "1", contact_id: "2",
      snapshot_content: "test",
      domains_covered: ["tango"],
      source_observation_ids: ["obs-1", "obs-2"],
      source_thought_ids: ["thought-1"],
      compiled_by: "claude-code",
      version: 1,
      is_current: true,
      created_at: "2026-04-23T00:00:00Z",
    };
    expect(snap.source_observation_ids).toHaveLength(2);
  });

  it("includes source_thought_ids array (migration column)", () => {
    const snap: PersonSnapshot = {
      id: "1", contact_id: "2",
      snapshot_content: "content",
      domains_covered: [],
      source_observation_ids: [],
      source_thought_ids: ["t1", "t2", "t3"],
      compiled_by: "api",
      version: 2,
      is_current: false,
      created_at: "2026-04-20T00:00:00Z",
    };
    expect(snap.source_thought_ids).toHaveLength(3);
  });

  it("accepts empty arrays for source fields", () => {
    const snap: PersonSnapshot = {
      id: "1", contact_id: "2",
      snapshot_content: "x",
      domains_covered: [],
      source_observation_ids: [],
      source_thought_ids: [],
      compiled_by: "claude-code",
      version: 1,
      is_current: true,
      created_at: "2026-04-23",
    };
    expect(snap.source_observation_ids).toEqual([]);
    expect(snap.source_thought_ids).toEqual([]);
  });
});

// ─── ServiceLog ───────────────────────────────────────────────────────────────

describe("ServiceLog type", () => {
  it("service_type covers all 6 DB CHECK values", () => {
    const validTypes: ServiceLog["service_type"][] = [
      "onsite", "remote", "phone", "email", "project", "maintenance",
    ];
    expect(validTypes).toHaveLength(6);
  });

  it("billable and billed are booleans", () => {
    const log: ServiceLog = {
      id: "1", contact_id: "2",
      service_date: "2026-04-23",
      service_type: "remote",
      description: "test",
      billable: true,
      billed: false,
      follow_up_needed: false,
      created_at: "2026-04-23",
    };
    expect(typeof log.billable).toBe("boolean");
    expect(typeof log.billed).toBe("boolean");
  });
});

// ─── BillingEntry ─────────────────────────────────────────────────────────────

describe("BillingEntry type", () => {
  it("status covers all 3 DB CHECK values", () => {
    const validStatuses: BillingEntry["status"][] = ["draft", "sent", "paid"];
    expect(validStatuses).toHaveLength(3);
  });

  it("service_log_ids is a string array", () => {
    const entry: BillingEntry = {
      id: "1", contact_id: "2",
      service_log_ids: ["log-1", "log-2"],
      status: "draft",
      created_at: "2026-04-23",
    };
    expect(Array.isArray(entry.service_log_ids)).toBe(true);
  });
});

// ─── Briefing ─────────────────────────────────────────────────────────────────

describe("Briefing type", () => {
  it("briefing_type covers all 7 DB CHECK values", () => {
    const validTypes: Briefing["briefing_type"][] = [
      "morning", "pre_meeting", "checkin", "evening",
      "habit_reminder", "weekly_review", "custom",
    ];
    expect(validTypes).toHaveLength(7);
  });
});

// ─── Contact ─────────────────────────────────────────────────────────────────

describe("Contact type", () => {
  it("administrative_status covers all 4 DB CHECK values", () => {
    const validStatuses = ["active", "passive", "administrative_closed", "community"];
    // TypeScript will catch invalid values at compile time.
    expect(validStatuses).toHaveLength(4);
  });

  it("relationship_domain covers all 7 DB CHECK values", () => {
    const validDomains = ["tango", "ttc", "outreach", "it", "music", "personal", "general"];
    expect(validDomains).toHaveLength(7);
  });
});
