import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
}));

vi.mock("@/lib/human-authority", () => ({
  getHumanAuthorityReadiness: mocks.readiness,
}));

const request = (password = "site-password") => new NextRequest(
  "https://dashboard.example.invalid/api/health/human-door?gate_test=1",
  { headers: { authorization: `Basic ${btoa(`health-gate:${password}`)}` } },
);

describe("Human Door health endpoint", () => {
  beforeEach(() => {
    process.env.SITE_PASSWORD = "site-password";
    mocks.readiness.mockReset();
  });

  afterEach(() => {
    delete process.env.SITE_PASSWORD;
  });

  it("returns only ready with 200 and always disables caching", async () => {
    mocks.readiness.mockResolvedValue("ready");
    const { GET } = await import("@/app/api/health/human-door/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(mocks.readiness).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("returns safe non-ready status with 503 and no identity", async () => {
    mocks.readiness.mockResolvedValue("authority_inactive");
    const { GET } = await import("@/app/api/health/human-door/route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "authority_inactive" });
    expect(JSON.stringify(body)).not.toContain("levi");
  });

  it("protects the endpoint with Basic Auth and no-store responses", async () => {
    const { GET } = await import("@/app/api/health/human-door/route");
    const response = await GET(request("wrong"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("fails closed when the site password is missing", async () => {
    delete process.env.SITE_PASSWORD;
    const { GET } = await import("@/app/api/health/human-door/route");
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "missing_configuration" });
  });
});
