import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HUMAN_AUTH_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "HUMAN_AUTH_EMAIL",
  "HUMAN_AUTH_PASSWORD",
] as const;

const READINESS_CHECK_TIMEOUT_MS = 5_000;
const READY_CACHE_TTL_MS = 60_000;
const FAILURE_CACHE_TTL_MS = 10_000;

type HumanAuthoritySelfStatus =
  | { status: "ready"; principal_id: string; display_name: string }
  | { status: "authority_missing" }
  | { status: "authority_inactive" };

export type HumanAuthorityReadiness =
  | "ready"
  | "missing_configuration"
  | "authentication_failed"
  | "authority_missing"
  | "authority_inactive"
  | "unknown_error";

let readinessCache: { status: HumanAuthorityReadiness; expiresAt: number } | null = null;
let readinessInFlight: Promise<HumanAuthorityReadiness> | null = null;

export function getHumanAuthorityConfiguration(): { configured: boolean; missing: string[] } {
  const missing = HUMAN_AUTH_ENV.filter((key) => !process.env[key]);
  return { configured: missing.length === 0, missing };
}

async function authenticateHumanAuthorityClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.HUMAN_AUTH_EMAIL;
  const password = process.env.HUMAN_AUTH_PASSWORD;

  if (!getHumanAuthorityConfiguration().configured || !supabaseUrl || !anonKey || !email || !password) {
    throw new Error("Human authority path is not configured");
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("HUMAN_AUTHORITY_AUTHENTICATION_FAILED");
  return client;
}

function isHumanAuthoritySelfStatus(value: unknown): value is HumanAuthoritySelfStatus {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  const status = (value as { status?: unknown }).status;
  if (status === "authority_missing" || status === "authority_inactive") return true;
  return status === "ready"
    && (value as { principal_id?: unknown }).principal_id === "levi"
    && (value as { display_name?: unknown }).display_name === "Levi Anthony";
}

function logSanitizedReadinessFailure(status: HumanAuthorityReadiness): void {
  console.error("[human-authority] readiness check failed", { category: status });
}

async function checkHumanAuthorityReadiness(): Promise<HumanAuthorityReadiness> {
  if (!getHumanAuthorityConfiguration().configured) return "missing_configuration";

  let client: SupabaseClient;
  try {
    client = await authenticateHumanAuthorityClient();
  } catch (error) {
    const status: HumanAuthorityReadiness = error instanceof Error
      && error.message === "HUMAN_AUTHORITY_AUTHENTICATION_FAILED"
      ? "authentication_failed"
      : "unknown_error";
    logSanitizedReadinessFailure(status);
    return status;
  }

  try {
    const { data, error } = await client.rpc("get_current_artifact_human_authority_status");
    if (error || !isHumanAuthoritySelfStatus(data)) {
      logSanitizedReadinessFailure("unknown_error");
      return "unknown_error";
    }
    return data.status;
  } catch {
    logSanitizedReadinessFailure("unknown_error");
    return "unknown_error";
  }
}

async function checkHumanAuthorityReadinessWithTimeout(): Promise<HumanAuthorityReadiness> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<HumanAuthorityReadiness>((resolve) => {
    timeout = setTimeout(() => {
      logSanitizedReadinessFailure("unknown_error");
      resolve("unknown_error");
    }, READINESS_CHECK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([checkHumanAuthorityReadiness(), timeoutResult]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getHumanAuthorityReadiness(
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<HumanAuthorityReadiness> {
  const now = Date.now();
  if (!forceRefresh && readinessCache && readinessCache.expiresAt > now) {
    return readinessCache.status;
  }
  if (readinessInFlight) return readinessInFlight;

  readinessInFlight = checkHumanAuthorityReadinessWithTimeout()
    .then((status) => {
      readinessCache = {
        status,
        expiresAt: Date.now() + (status === "ready" ? READY_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
      };
      return status;
    })
    .finally(() => {
      readinessInFlight = null;
    });
  return readinessInFlight;
}

export function humanAuthorityReadinessMessage(status: HumanAuthorityReadiness): string {
  switch (status) {
    case "ready":
      return "Human editing is ready.";
    case "missing_configuration":
      return "Human editing is unavailable because this runtime is missing required configuration.";
    case "authentication_failed":
      return "Human editing is unavailable because the reviewer account could not authenticate.";
    case "authority_missing":
      return "Human editing is unavailable because the reviewer account has no authority mapping.";
    case "authority_inactive":
      return "Human editing is unavailable because the reviewer authority mapping is inactive.";
    case "unknown_error":
      return "Human editing is unavailable because readiness could not be verified.";
  }
}

export async function getReadyHumanAuthorityClient(): Promise<SupabaseClient> {
  const status: HumanAuthorityReadiness = await getHumanAuthorityReadiness({ forceRefresh: true });
  if (status !== "ready") throw new Error(`HUMAN_AUTHORITY_NOT_READY:${status}`);
  return authenticateHumanAuthorityClient();
}
