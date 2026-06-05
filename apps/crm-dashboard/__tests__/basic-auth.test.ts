import { describe, expect, it } from "vitest";
import { hasBasicAuthPassword } from "@/lib/basic-auth";

describe("basic auth parsing", () => {
  it("accepts any username with the expected password", () => {
    expect(hasBasicAuthPassword(`Basic ${btoa("health:test-password")}`, "test-password")).toBe(true);
  });

  it("fails closed for missing, malformed, and incorrect credentials", () => {
    expect(hasBasicAuthPassword(null, "test-password")).toBe(false);
    expect(hasBasicAuthPassword("Basic not-valid-base64!!!!", "test-password")).toBe(false);
    expect(hasBasicAuthPassword(`Basic ${btoa("health:wrong")}`, "test-password")).toBe(false);
  });
});
