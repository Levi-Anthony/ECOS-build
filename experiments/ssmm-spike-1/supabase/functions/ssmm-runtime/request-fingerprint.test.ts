import { parseRequest, PROTOCOL_VERSION } from "./contracts.ts";
import {
  canonicalRuntimeRequest,
  fingerprintRuntimeRequest,
} from "./request-fingerprint.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const request = (overrides: Record<string, unknown> = {}) =>
  parseRequest({
    action: "accept_shape_proposal",
    client_event_id: "fingerprint-test-0001",
    loop_id: "00000000-0000-4000-8000-000000000001",
    expected_loop_revision: 4,
    accepted_proposal_id: "00000000-0000-4000-8000-000000000002",
    accepted_proposal_version: 2,
    input: {
      declared_starting_conditions: "At the desk",
      nested: { zebra: 1, alpha: 2 },
    },
    client: { source: "direct_test", shortcut_version: "test-v1" },
    ...overrides,
  });

Deno.test("canonical request sorting is deterministic across object key order", async () => {
  const left = request();
  const right = request({
    input: {
      nested: { alpha: 2, zebra: 1 },
      declared_starting_conditions: "At the desk",
    },
  });
  const leftFingerprint = await fingerprintRuntimeRequest(left, PROTOCOL_VERSION);
  const rightFingerprint = await fingerprintRuntimeRequest(right, PROTOCOL_VERSION);
  assertEquals(leftFingerprint.canonicalText, rightFingerprint.canonicalText);
  assertEquals(leftFingerprint.sha256, rightFingerprint.sha256);
});

Deno.test("semantic authority fields participate in the fingerprint", async () => {
  const base = await fingerprintRuntimeRequest(request(), PROTOCOL_VERSION);
  const variants = [
    request({ action: "record_installation_action" }),
    request({ input: { declared_starting_conditions: "Elsewhere" } }),
    request({ expected_loop_revision: 5 }),
    request({ accepted_proposal_version: 3 }),
    request({ loop_id: "00000000-0000-4000-8000-000000000099" }),
  ];
  for (const variant of variants) {
    const candidate = await fingerprintRuntimeRequest(variant, PROTOCOL_VERSION);
    if (candidate.sha256 === base.sha256) {
      throw new Error("semantic request change did not change fingerprint");
    }
  }
});

Deno.test("canonical document contains the complete bounded fingerprint contract", () => {
  assertEquals(canonicalRuntimeRequest(request(), PROTOCOL_VERSION), {
    accepted_proposal_id: "00000000-0000-4000-8000-000000000002",
    accepted_proposal_version: 2,
    action: "accept_shape_proposal",
    client: { shortcut_version: "test-v1", source: "direct_test" },
    expected_loop_revision: 4,
    input: {
      declared_starting_conditions: "At the desk",
      nested: { alpha: 2, zebra: 1 },
    },
    loop_id: "00000000-0000-4000-8000-000000000001",
    protocol_version: PROTOCOL_VERSION,
  });
});

const assertThrows = (fn: () => unknown, expected: string) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message === expected) return;
    throw error;
  }
  throw new Error(`Expected ${expected}`);
};

Deno.test("mutating requests require an expected loop revision", () => {
  assertThrows(
    () => parseRequest({
      action: "submit_sense_input",
      client_event_id: "revision-required-0001",
      loop_id: "00000000-0000-4000-8000-000000000001",
      input: { grounded_input: "present field" },
      client: { source: "direct_test", shortcut_version: "test-v1" },
    }),
    "expected_loop_revision_required",
  );
});

Deno.test("proposal-bound actions require exact proposal identity", () => {
  assertThrows(
    () => parseRequest({
      action: "accept_shape_proposal",
      client_event_id: "proposal-required-0001",
      loop_id: "00000000-0000-4000-8000-000000000001",
      expected_loop_revision: 2,
      input: {},
      client: { source: "direct_test", shortcut_version: "test-v1" },
    }),
    "accepted_proposal_id_required",
  );
});

Deno.test("read-only re-entry may omit an expected loop revision", () => {
  const parsed = parseRequest({
    action: "open_current_surface",
    client_event_id: "readonly-open-0001",
    loop_id: "00000000-0000-4000-8000-000000000001",
    input: {},
    client: { source: "direct_test", shortcut_version: "test-v1" },
  });
  assertEquals(parsed.expected_loop_revision, null);
});
