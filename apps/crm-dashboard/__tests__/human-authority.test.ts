import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

const configuredEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key",
  HUMAN_AUTH_EMAIL: "reviewer@example.invalid",
  HUMAN_AUTH_PASSWORD: "test-password",
};

const loadModule = async () => import("@/lib/human-authority");

const mockClient = ({
  authError = null,
  rpcData = { status: "ready", principal_id: "levi", display_name: "Levi Anthony" },
  rpcError = null,
  rpc,
}: {
  authError?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
  rpc?: ReturnType<typeof vi.fn>;
} = {}) => {
  const client = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: authError }),
    },
    rpc: rpc ?? vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  };
  mocks.createClient.mockReturnValue(client);
  return client;
};

describe("human authority readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.createClient.mockReset();
    Object.assign(process.env, configuredEnvironment);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(configuredEnvironment)) delete process.env[key];
  });

  it("distinguishes missing configuration without creating a client", async () => {
    delete process.env.HUMAN_AUTH_PASSWORD;
    const { getHumanAuthorityReadiness } = await loadModule();

    await expect(getHumanAuthorityReadiness()).resolves.toBe("missing_configuration");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("distinguishes reviewer authentication failure from mapping failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockClient({ authError: { message: "raw provider detail" } });
    const first = await loadModule();
    await expect(first.getHumanAuthorityReadiness()).resolves.toBe("authentication_failed");

    vi.resetModules();
    mockClient({ rpcData: { status: "authority_missing" } });
    const second = await loadModule();
    await expect(second.getHumanAuthorityReadiness()).resolves.toBe("authority_missing");
  });

  it("uses the authenticated reviewer session and validates the exact ready payload", async () => {
    const client = mockClient();
    const { getHumanAuthorityReadiness } = await loadModule();

    await expect(getHumanAuthorityReadiness()).resolves.toBe("ready");
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: configuredEnvironment.HUMAN_AUTH_EMAIL,
      password: configuredEnvironment.HUMAN_AUTH_PASSWORD,
    });
    expect(client.rpc).toHaveBeenCalledWith("get_current_artifact_human_authority_status");
  });

  it("trims surrounding whitespace/newlines in env values before authenticating", async () => {
    // Regression: a trailing newline in HUMAN_AUTH_EMAIL (from `echo | vercel env add`)
    // made signInWithPassword fail with invalid_credentials in production for ~6 days.
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "  https://example.supabase.co  ",
      SUPABASE_ANON_KEY: "anon-test-key\n",
      HUMAN_AUTH_EMAIL: "reviewer@example.invalid\n",
      HUMAN_AUTH_PASSWORD: "\ttest-password\n",
    });
    const client = mockClient();
    const { getHumanAuthorityReadiness } = await loadModule();

    await expect(getHumanAuthorityReadiness()).resolves.toBe("ready");
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-test-key",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "reviewer@example.invalid",
      password: "test-password",
    });
  });

  it("only returns a mutation client after a fresh ready self-status check", async () => {
    const client = mockClient();
    const { getReadyHumanAuthorityClient } = await loadModule();

    await expect(getReadyHumanAuthorityClient()).resolves.toBe(client);
    expect(client.rpc).toHaveBeenCalledWith("get_current_artifact_human_authority_status");
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it("does not return a mutation client when the fresh self-status check is not ready", async () => {
    mockClient({ rpcData: { status: "authority_missing" } });
    const { getReadyHumanAuthorityClient } = await loadModule();

    await expect(getReadyHumanAuthorityClient()).rejects.toThrow(
      "HUMAN_AUTHORITY_NOT_READY:authority_missing",
    );
  });

  it("deduplicates concurrent readiness checks", async () => {
    let resolveRpc: ((value: unknown) => void) | undefined;
    const rpc = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveRpc = resolve;
    }));
    mockClient({ rpc });
    const { getHumanAuthorityReadiness } = await loadModule();

    const first = getHumanAuthorityReadiness();
    const second = getHumanAuthorityReadiness();
    resolveRpc?.({
      data: { status: "ready", principal_id: "levi", display_name: "Levi Anthony" },
      error: null,
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["ready", "ready"]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("caches ready for 60 seconds, failures for at most 10 seconds, and honors force refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    const client = mockClient();
    const { getHumanAuthorityReadiness } = await loadModule();

    await getHumanAuthorityReadiness();
    await getHumanAuthorityReadiness();
    expect(client.rpc).toHaveBeenCalledTimes(1);

    await getHumanAuthorityReadiness({ forceRefresh: true });
    expect(client.rpc).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-06-05T12:01:01Z"));
    await getHumanAuthorityReadiness();
    expect(client.rpc).toHaveBeenCalledTimes(3);

    vi.resetModules();
    vi.setSystemTime(new Date("2026-06-05T13:00:00Z"));
    const failedClient = mockClient({ rpcData: { status: "authority_inactive" } });
    const failedModule = await loadModule();
    await failedModule.getHumanAuthorityReadiness();
    vi.setSystemTime(new Date("2026-06-05T13:00:11Z"));
    await failedModule.getHumanAuthorityReadiness();
    expect(failedClient.rpc).toHaveBeenCalledTimes(2);
  });

  it("returns unknown_error and logs only a sanitized category for raw provider failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockClient({ rpcError: { message: "sensitive raw provider failure" } });
    const { getHumanAuthorityReadiness } = await loadModule();

    await expect(getHumanAuthorityReadiness()).resolves.toBe("unknown_error");
    expect(errorLog).toHaveBeenCalledWith(
      "[human-authority] readiness check failed",
      { category: "unknown_error" },
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive raw provider failure");
  });

  it("bounds readiness checks so dependency stalls do not block read-only rendering indefinitely", async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockClient({ rpc: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    const { getHumanAuthorityReadiness } = await loadModule();

    const readiness = getHumanAuthorityReadiness();
    await vi.advanceTimersByTimeAsync(5_001);

    await expect(readiness).resolves.toBe("unknown_error");
    expect(errorLog).toHaveBeenCalledWith(
      "[human-authority] readiness check failed",
      { category: "unknown_error" },
    );
  });
});
