import type { ArtifactPatchOp } from "@/lib/supabase";

export const ARTIFACT_AUTHORITY_LEVELS = [
  "evidence",
  "draft",
  "proposed_instruction",
  "approved_instruction",
  "policy",
] as const;

export const ARTIFACT_LIFECYCLE_STATUSES = [
  "active",
  "draft",
  "archived",
  "superseded",
] as const;

export const ARTIFACT_REVIEW_POLICIES = [
  "live_audit",
  "human_gate",
] as const;

type ArtifactAuthorityLevel = typeof ARTIFACT_AUTHORITY_LEVELS[number];
type ArtifactReviewPolicy = typeof ARTIFACT_REVIEW_POLICIES[number];

type GovernanceSelection = {
  currentStatus: string;
  status: string;
  currentReviewPolicy: string;
  reviewPolicy: string;
  currentAuthority: string;
  authority: string;
};

function includesValue<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return (values as readonly string[]).includes(value);
}

function requireOneOf<const T extends readonly string[]>(field: string, value: string, values: T): T[number] {
  if (!includesValue(values, value)) {
    throw new Error(`BAD_OP: invalid ${field}`);
  }
  return value;
}

export function buildArtifactGovernanceOps(selection: GovernanceSelection): ArtifactPatchOp[] {
  const status = requireOneOf("artifact status", selection.status, ARTIFACT_LIFECYCLE_STATUSES);
  const reviewPolicy = requireOneOf("review policy", selection.reviewPolicy, ARTIFACT_REVIEW_POLICIES);
  const authority = requireOneOf("authority level", selection.authority, ARTIFACT_AUTHORITY_LEVELS);
  const ops: ArtifactPatchOp[] = [];

  if (status !== selection.currentStatus) ops.push({ op: "set_artifact_status", status });
  if (reviewPolicy !== selection.currentReviewPolicy) {
    ops.push({ op: "set_review_policy", review_policy: reviewPolicy as ArtifactReviewPolicy });
  }
  if (authority !== selection.currentAuthority) {
    ops.push({
      op: "update_artifact_metadata",
      metadata_patch: { authority_level: authority as ArtifactAuthorityLevel },
    });
  }

  return ops;
}
