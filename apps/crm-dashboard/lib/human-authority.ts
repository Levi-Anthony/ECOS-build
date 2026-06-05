import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export async function getHumanAuthorityClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.HUMAN_AUTH_EMAIL;
  const password = process.env.HUMAN_AUTH_PASSWORD;

  if (!supabaseUrl || !anonKey || !email || !password) {
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
  if (error) throw new Error(`Human authority authentication failed: ${error.message}`);
  return client;
}
