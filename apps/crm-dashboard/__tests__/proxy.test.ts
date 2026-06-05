import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("dashboard proxy", () => {
  afterEach(() => {
    delete process.env.SITE_PASSWORD;
  });

  it("marks Human Door health responses no-store even when Basic Auth fails", () => {
    process.env.SITE_PASSWORD = "site-password";
    const response = proxy(new NextRequest("https://dashboard.example.invalid/api/health/human-door"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed instead of throwing on malformed Basic Auth", () => {
    process.env.SITE_PASSWORD = "site-password";
    const response = proxy(new NextRequest("https://dashboard.example.invalid/artifacts", {
      headers: { authorization: "Basic invalid!!!!" },
    }));

    expect(response.status).toBe(401);
  });

  it("returns a safe missing_configuration health status when the site password is absent", async () => {
    const response = proxy(new NextRequest("https://dashboard.example.invalid/api/health/human-door"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "missing_configuration" });
  });
});
