import type { RuntimeRequest } from "./contracts.ts";

export type CanonicalRuntimeRequest = {
  protocol_version: string;
  loop_id: string | null;
  action: RuntimeRequest["action"];
  input: unknown;
  expected_loop_revision: number | null;
  accepted_proposal_id: string | null;
  accepted_proposal_version: number | null;
  client: {
    source: RuntimeRequest["client"]["source"];
    shortcut_version: string;
  };
};

export type RuntimeRequestFingerprint = {
  canonical: CanonicalRuntimeRequest;
  canonicalText: string;
  sha256: string;
};

export function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_json_number");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  throw new Error("non_json_fingerprint_value");
}

export function canonicalRuntimeRequest(
  request: RuntimeRequest,
  protocolVersion: string,
): CanonicalRuntimeRequest {
  return normalizeJson({
    protocol_version: protocolVersion,
    loop_id: request.loop_id,
    action: request.action,
    input: request.input,
    expected_loop_revision: request.expected_loop_revision ?? null,
    accepted_proposal_id: request.accepted_proposal_id ?? null,
    accepted_proposal_version: request.accepted_proposal_version ?? null,
    client: request.client,
  }) as CanonicalRuntimeRequest;
}

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function fingerprintRuntimeRequest(
  request: RuntimeRequest,
  protocolVersion: string,
): Promise<RuntimeRequestFingerprint> {
  const canonical = canonicalRuntimeRequest(request, protocolVersion);
  const canonicalText = JSON.stringify(canonical);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalText),
  );
  return { canonical, canonicalText, sha256: toHex(digest) };
}
