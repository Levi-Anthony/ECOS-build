import { parseConflict, RepositoryError } from "./repository.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const postgrestError = (
  status: number,
  code: string,
  message: string,
  details: unknown = null,
) => new RepositoryError(status, JSON.stringify({ code, message, details }));

Deno.test("PT409 approved authority conflicts map to the safe HTTP schema", () => {
  assertEquals(
    parseConflict(postgrestError(
      409,
      "PT409",
      "stale_proposal",
      JSON.stringify({
        current_loop_revision: 7,
        current_proposal_id: "00000000-0000-4000-8000-000000000007",
        current_proposal_version: 3,
        raw_database_field: "must not escape",
      }),
    )),
    {
      error: "conflict",
      category: "stale_proposal",
      current_loop_revision: 7,
      current_proposal_id: "00000000-0000-4000-8000-000000000007",
      current_proposal_version: 3,
    },
  );

  for (
    const category of [
      "stale_loop_revision",
      "idempotency_fingerprint_conflict",
    ]
  ) {
    assertEquals(
      parseConflict(postgrestError(
        409,
        "PT409",
        category,
        JSON.stringify({ current_loop_revision: 4 }),
      )),
      { error: "conflict", category, current_loop_revision: 4 },
    );
  }
});

Deno.test("unexpected database failures are never classified as authority conflicts", () => {
  const unexpected = [
    postgrestError(500, "40001", "stale_loop_revision"),
    postgrestError(409, "23505", "stale_loop_revision"),
    postgrestError(409, "PT409", "unknown_conflict"),
    postgrestError(500, "PT409", "stale_loop_revision"),
    new RepositoryError(409, "stale_loop_revision"),
  ];
  for (const error of unexpected) assertEquals(parseConflict(error), null);
});

Deno.test("malformed conflict details cannot expose raw database errors", () => {
  assertEquals(
    parseConflict(postgrestError(
      409,
      "PT409",
      "stale_proposal",
      "not-json: raw database material",
    )),
    {
      error: "conflict",
      category: "stale_proposal",
      current_loop_revision: null,
      current_proposal_id: null,
      current_proposal_version: null,
    },
  );
});
