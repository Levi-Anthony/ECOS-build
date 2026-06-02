// Service-role Supabase client factory.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are validated at startup by helpers.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
