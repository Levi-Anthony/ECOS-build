import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHumanAuthorityReadiness: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/human-authority", () => ({
  getHumanAuthorityReadiness: mocks.getHumanAuthorityReadiness,
  humanAuthorityReadinessMessage: (status: string) => `message:${status}`,
}));

const loadModule = async () => import("@/app/api/health/human-door/route");

describe("GET /api/health/human-door", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.getHumanAuthorityReadiness.mockReset();
  });

  it("returns 200 with status ready when the human authority path is ready", async () => {
    mocks.getHumanAuthorityReadiness.mockResolvedValue("ready");
    const { GET } = await loadModule();

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(mocks.getHumanAuthorityReadiness).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("returns 503 with status and reason when the human authority path is not ready", async () => {
    mocks.getHumanAuthorityReadiness.mockResolvedValue("authentication_failed");
    const { GET } = await loadModule();

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "authentication_failed",
      reason: "message:authentication_failed",
    });
  });

  it("does not leak credential values for missing configuration", async () => {
    mocks.getHumanAuthorityReadiness.mockResolvedValue("missing_configuration");
    const { GET } = await loadModule();

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "missing_configuration",
      reason: "message:missing_configuration",
    });
  });
});
