import { constantTimeSecretMatch } from "./auth.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("shared secret accepts only exact match", async () => {
  assert(
    await constantTimeSecretMatch("correct", "correct"),
    "exact match failed",
  );
  assert(
    !await constantTimeSecretMatch("wrong", "correct"),
    "wrong secret passed",
  );
  assert(
    !await constantTimeSecretMatch(null, "correct"),
    "missing secret passed",
  );
});
