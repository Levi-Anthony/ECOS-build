export type ArtifactActionResult = "success" | "warning" | "error" | "info";

export type ArtifactActionFeedback = {
  result: ArtifactActionResult;
  label: string;
  message: string;
};

type FeedbackSearchParams = {
  action_result?: string;
  action_label?: string;
  action_message?: string;
};

const VALID_RESULTS = new Set<ArtifactActionResult>(["success", "warning", "error", "info"]);

export function artifactActionFeedbackHref(path: string, feedback: ArtifactActionFeedback): string {
  const params = new URLSearchParams({
    action_result: feedback.result,
    action_label: feedback.label,
    action_message: feedback.message,
  });
  return `${path}?${params.toString()}#action-feedback`;
}

export function readArtifactActionFeedback(params: FeedbackSearchParams): ArtifactActionFeedback | null {
  if (
    !VALID_RESULTS.has(params.action_result as ArtifactActionResult)
    || !params.action_label
    || !params.action_message
  ) {
    return null;
  }
  return {
    result: params.action_result as ArtifactActionResult,
    label: params.action_label,
    message: params.action_message,
  };
}

export function artifactActionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/HUMAN_AUTHORITY_NOT_READY:missing_configuration|HUMAN_AUTHORITY_MISSING_CONFIGURATION/i.test(message)) {
    return "Human editing is not configured in this runtime. No changes were applied.";
  }
  if (/HUMAN_AUTHORITY_NOT_READY:authentication_failed|HUMAN_AUTHORITY_AUTHENTICATION_FAILED/i.test(message)) {
    return "Human editing could not authenticate the reviewer account. No changes were applied.";
  }
  if (/HUMAN_AUTHORITY_NOT_READY:authority_missing/i.test(message)) {
    return "Human editing is unavailable because the reviewer authority mapping is missing. No changes were applied.";
  }
  if (/HUMAN_AUTHORITY_NOT_READY:authority_inactive/i.test(message)) {
    return "Human editing is unavailable because the reviewer authority mapping is inactive. No changes were applied.";
  }
  if (/HUMAN_AUTHORITY_NOT_READY:unknown_error/i.test(message)) {
    return "Human editing readiness could not be verified. No changes were applied.";
  }
  if (/VERSION_CONFLICT|HASH_CONFLICT/i.test(message)) {
    return "This artifact changed after the form was opened. No changes were applied. Review the refreshed version and try again.";
  }
  if (/HUMAN_AUTH/i.test(message)) {
    return "Human edit authorization failed. No changes were applied. Check the reviewer account and authority mapping.";
  }
  if (/INVALID_STATUS_TRANSITION/i.test(message)) {
    return "That lifecycle transition is not allowed. No changes were applied.";
  }
  if (/BAD_OP|BAD_PATH|MISSING_PATH|PATH_EXISTS|UNKNOWN_OP|Unexpected token|JSON/i.test(message)) {
    return "The requested edit was rejected as invalid. No changes were applied.";
  }
  return "The artifact write failed. No changes were applied.";
}

export function acceptedWriteFeedback(label: string, version: number | undefined, warningCount: number): ArtifactActionFeedback {
  const versionText = version === undefined ? "a new accepted version" : `accepted version ${version}`;
  if (warningCount > 0) {
    return {
      result: "warning",
      label,
      message: `Saved ${versionText}, but embedding regeneration remains pending for ${warningCount} changed block${warningCount === 1 ? "" : "s"}.`,
    };
  }
  return {
    result: "success",
    label,
    message: `Saved ${versionText}.`,
  };
}
