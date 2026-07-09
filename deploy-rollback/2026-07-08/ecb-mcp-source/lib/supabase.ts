// Admin Supabase client factory.
// helpers.ts prefers SUPABASE_SECRET_KEYS.default and falls back to the legacy
// SUPABASE_SERVICE_ROLE_KEY only for local/older runtimes.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "../helpers.ts";

export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
