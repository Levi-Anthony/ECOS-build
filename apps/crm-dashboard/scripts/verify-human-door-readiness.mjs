import { createClient } from "@supabase/supabase-js";

const required = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  email: process.env.HUMAN_AUTH_EMAIL,
  password: process.env.HUMAN_AUTH_PASSWORD,
};

const safeExit = (status) => {
  console.error(`Human Door verifier: ${status}`);
  process.exit(1);
};

if (Object.values(required).some((value) => !value)) safeExit("missing_configuration");

const client = createClient(required.supabaseUrl, required.anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const { error: authError } = await client.auth.signInWithPassword({
  email: required.email,
  password: required.password,
});
if (authError) safeExit("authentication_failed");

const { data, error } = await client.rpc("get_current_artifact_human_authority_status");
if (error || !data || typeof data !== "object") safeExit("unknown_error");

if (
  data.status === "ready"
  && data.principal_id === "levi"
  && data.display_name === "Levi Anthony"
) {
  console.log("Human Door verifier: ready");
  process.exit(0);
}

if (data.status === "authority_missing" || data.status === "authority_inactive") {
  safeExit(data.status);
}

safeExit("unknown_error");
