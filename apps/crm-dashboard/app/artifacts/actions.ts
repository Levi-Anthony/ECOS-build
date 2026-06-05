"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import { reindexArtifactPaths } from "@/lib/ecb-mcp";
import { getHumanAuthorityClient } from "@/lib/human-authority";
import type { ArtifactPatchOp } from "@/lib/supabase";

const required = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing ${key}`);
  return value.trim();
};

const parseVersion = (formData: FormData): number => {
  const version = Number(required(formData, "base_version"));
  if (!Number.isInteger(version)) throw new Error("Invalid base_version");
  return version;
};

const finishArtifactWrite = async (key: string, changedPaths: string[]) => {
  await reindexArtifactPaths(key, changedPaths);
  revalidatePath("/artifacts");
  revalidatePath("/artifacts/review");
  revalidatePath(`/artifacts/${encodeURIComponent(key)}`);
};

export async function editArtifactBlockAction(formData: FormData) {
  const key = required(formData, "key");
  const path = required(formData, "path");
  const expectedHash = required(formData, "expected_hash");
  const rawContent = formData.get("content");
  if (typeof rawContent !== "string") throw new Error("Missing content");
  const content = rawContent;
  const reason = required(formData, "reason");
  const baseVersion = parseVersion(formData);

  const human = await getHumanAuthorityClient();
  const { data, error } = await human.rpc("apply_artifact_human_patch_tx", {
    p_key: key,
    p_base_version: baseVersion,
    p_ops: [{ op: "replace_block", path, expected_hash: expectedHash, content }],
    p_summary: reason,
    p_source_refs: { surface: "crm-dashboard", action: "direct_block_edit" },
  });
  if (error) throw new Error(error.message);
  const result = data as { changed_paths?: string[] };
  await finishArtifactWrite(key, result.changed_paths ?? [path]);
}

export async function updateArtifactGovernanceAction(formData: FormData) {
  const key = required(formData, "key");
  const baseVersion = parseVersion(formData);
  const reason = required(formData, "reason");
  const currentStatus = required(formData, "current_status");
  const currentReviewPolicy = required(formData, "current_review_policy");
  const currentAuthority = String(formData.get("current_authority") ?? "");
  const status = required(formData, "status");
  const reviewPolicy = required(formData, "review_policy");
  const authority = required(formData, "authority_level");
  const ops: ArtifactPatchOp[] = [];

  if (status !== currentStatus) ops.push({ op: "set_artifact_status", status });
  if (reviewPolicy !== currentReviewPolicy) ops.push({ op: "set_review_policy", review_policy: reviewPolicy as "live_audit" | "human_gate" });
  if (authority !== currentAuthority) ops.push({ op: "update_artifact_metadata", metadata_patch: { authority_level: authority } });
  if (ops.length === 0) return;

  const human = await getHumanAuthorityClient();
  const { data, error } = await human.rpc("apply_artifact_human_patch_tx", {
    p_key: key,
    p_base_version: baseVersion,
    p_ops: ops,
    p_summary: reason,
    p_source_refs: { surface: "crm-dashboard", action: "governance_update" },
  });
  if (error) throw new Error(error.message);
  const result = data as { changed_paths?: string[] };
  await finishArtifactWrite(key, result.changed_paths ?? []);
}

export async function reviewArtifactProposalAction(formData: FormData) {
  const proposalId = required(formData, "proposal_id");
  const action = required(formData, "action");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  let replacementOps: ArtifactPatchOp[] | null = null;

  if (action === "edit_and_approve") {
    const raw = required(formData, "replacement_ops");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("replacement_ops must be a non-empty JSON array");
    replacementOps = parsed as ArtifactPatchOp[];
  }

  const human = await getHumanAuthorityClient();
  const { data, error } = await human.rpc("review_artifact_change_tx", {
    p_proposal_id: proposalId,
    p_action: action,
    p_reason: reason,
    p_replacement_ops: replacementOps,
  });
  if (error) throw new Error(error.message);

  const result = data as {
    status: string;
    patch_result?: { artifact_id?: string; changed_paths?: string[] };
  };
  let key: string | null = null;
  if (result.patch_result?.artifact_id) {
    const { data: artifact } = await supabase.from("artifacts")
      .select("key").eq("id", result.patch_result.artifact_id).maybeSingle();
    key = (artifact as { key?: string } | null)?.key ?? null;
  } else {
    const { data: proposal } = await supabase.from("artifact_change_proposals")
      .select("artifact_id").eq("id", proposalId).maybeSingle();
    if (proposal) {
      const { data: artifact } = await supabase.from("artifacts")
        .select("key").eq("id", (proposal as { artifact_id: string }).artifact_id).maybeSingle();
      key = (artifact as { key?: string } | null)?.key ?? null;
    }
  }

  if (key) await finishArtifactWrite(key, result.patch_result?.changed_paths ?? []);
  revalidatePath(`/artifacts/review/${proposalId}`);
}
