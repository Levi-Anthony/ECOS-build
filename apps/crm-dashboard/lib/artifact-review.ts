import type { ArtifactBlock, ArtifactPatchOp } from "@/lib/supabase";

export const artifactOpPath = (op: ArtifactPatchOp): string =>
  op.path ?? op.from_path ?? "/artifact";

export const artifactOpLabel = (op: ArtifactPatchOp): string => {
  if (op.op === "rename_block") return `rename ${op.from_path ?? "block"} -> ${op.to_path ?? "unknown"}`;
  if (op.op === "set_artifact_status") return `set lifecycle status: ${op.status ?? "unknown"}`;
  if (op.op === "set_review_policy") return `set review policy: ${op.review_policy ?? "unknown"}`;
  if (op.op === "update_artifact_metadata") return "update artifact metadata";
  return `${op.op.replaceAll("_", " ")}: ${artifactOpPath(op)}`;
};

export const currentBlockForOp = (op: ArtifactPatchOp, blocks: ArtifactBlock[]): ArtifactBlock | undefined => {
  const path = op.op === "rename_block" ? op.from_path : op.path;
  return blocks.find((block) => block.path === path);
};

export const proposedContentForOp = (op: ArtifactPatchOp, current?: ArtifactBlock): string | null => {
  if (op.op === "append_block") {
    return [current?.content, op.content].filter(Boolean).join("\n\n");
  }
  if (op.op === "delete_block") return null;
  if (op.op === "update_block_metadata" || op.op === "update_artifact_metadata") {
    return JSON.stringify(op.metadata_patch ?? {}, null, 2);
  }
  if (op.op === "set_artifact_status") return op.status ?? null;
  if (op.op === "set_review_policy") return op.review_policy ?? null;
  if (op.op === "rename_block") return op.to_path ?? null;
  return typeof op.content === "string" ? op.content : null;
};

export const contentChanged = (op: ArtifactPatchOp): boolean =>
  ["create_block", "replace_block", "append_block", "delete_block"].includes(op.op);
