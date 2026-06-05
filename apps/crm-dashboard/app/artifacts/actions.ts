"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase-server";
import { reindexArtifactPaths } from "@/lib/ecb-mcp";
import { getHumanAuthorityClient } from "@/lib/human-authority";
import { artifactBlockContentHash, normalizeArtifactBlockContent } from "@/lib/artifact-editor";
import {
  acceptedWriteFeedback,
  artifactActionErrorMessage,
  artifactActionFeedbackHref,
  type ArtifactActionFeedback,
} from "@/lib/artifact-action-feedback";
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

const finishArtifactWrite = async (key: string, changedPaths: string[]): Promise<string[]> => {
  const warnings = await reindexArtifactPaths(key, changedPaths);
  try {
    revalidatePath("/artifacts");
    revalidatePath("/artifacts/review");
    revalidatePath(`/artifacts/${encodeURIComponent(key)}`);
  } catch {
    warnings.push("Dashboard cache refresh failed.");
  }
  return warnings;
};

export async function editArtifactBlockAction(formData: FormData) {
  const key = required(formData, "key");
  let feedback: ArtifactActionFeedback;
  try {
    const path = required(formData, "path");
    const expectedHash = required(formData, "expected_hash");
    const rawContent = formData.get("content");
    if (typeof rawContent !== "string") throw new Error("Missing content");
    const content = normalizeArtifactBlockContent(rawContent);
    const reason = required(formData, "reason");
    const baseVersion = parseVersion(formData);

    const submittedHash = artifactBlockContentHash(content);
    if (submittedHash === expectedHash) {
      feedback = {
        result: "info",
        label: "Block edit",
        message: "No content changed, so no new version was created.",
      };
    } else {
      const human = await getHumanAuthorityClient();
      const { data, error } = await human.rpc("apply_artifact_human_patch_tx", {
        p_key: key,
        p_base_version: baseVersion,
        p_ops: [{ op: "replace_block", path, expected_hash: expectedHash, content }],
        p_summary: reason,
        p_source_refs: { surface: "crm-dashboard", action: "direct_block_edit" },
      });
      if (error) throw new Error(error.message);
      const result = data as { new_version?: number; changed_paths?: string[] };
      const warnings = await finishArtifactWrite(key, result.changed_paths ?? [path]);
      feedback = acceptedWriteFeedback("Block edit", result.new_version, warnings.length);
    }
  } catch (error) {
    feedback = { result: "error", label: "Block edit failed", message: artifactActionErrorMessage(error) };
  }
  redirect(artifactActionFeedbackHref(`/artifacts/${encodeURIComponent(key)}`, feedback));
}

export async function updateArtifactGovernanceAction(formData: FormData) {
  const key = required(formData, "key");
  let feedback: ArtifactActionFeedback;
  try {
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

    if (ops.length === 0) {
      feedback = {
        result: "info",
        label: "Governance update",
        message: "No governance fields changed, so no new version was created.",
      };
    } else {
      const human = await getHumanAuthorityClient();
      const { data, error } = await human.rpc("apply_artifact_human_patch_tx", {
        p_key: key,
        p_base_version: baseVersion,
        p_ops: ops,
        p_summary: reason,
        p_source_refs: { surface: "crm-dashboard", action: "governance_update" },
      });
      if (error) throw new Error(error.message);
      const result = data as { new_version?: number; changed_paths?: string[] };
      const warnings = await finishArtifactWrite(key, result.changed_paths ?? []);
      feedback = acceptedWriteFeedback("Governance update", result.new_version, warnings.length);
    }
  } catch (error) {
    feedback = { result: "error", label: "Governance update failed", message: artifactActionErrorMessage(error) };
  }
  redirect(artifactActionFeedbackHref(`/artifacts/${encodeURIComponent(key)}`, feedback));
}

export async function reviewArtifactProposalAction(formData: FormData) {
  const proposalId = required(formData, "proposal_id");
  let feedback: ArtifactActionFeedback;
  try {
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
      patch_result?: { artifact_id?: string; new_version?: number; changed_paths?: string[] };
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

    const warnings = key ? await finishArtifactWrite(key, result.patch_result?.changed_paths ?? []) : [];
    revalidatePath(`/artifacts/review/${proposalId}`);
    feedback = result.patch_result
      ? acceptedWriteFeedback("Proposal review", result.patch_result.new_version, warnings.length)
      : result.status === "conflicted"
        ? {
            result: "warning",
            label: "Proposal review conflicted",
            message: "The proposal was not applied because the artifact changed after it was proposed. Review the current version before retrying.",
          }
        : { result: "success", label: "Proposal review", message: `Recorded proposal status: ${result.status.replaceAll("_", " ")}.` };
  } catch (error) {
    feedback = { result: "error", label: "Proposal review failed", message: artifactActionErrorMessage(error) };
  }
  redirect(artifactActionFeedbackHref(`/artifacts/review/${proposalId}`, feedback));
}
