const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`SSMM runtime configuration is incomplete: ${name}`);
  }
  return value;
};

// Configuration is resolved at module load so a broken deployment fails boot
// instead of leaking configuration names through per-request responses.
export const config = Object.freeze({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  runtimeSecret: requireEnv("SSMM_RUNTIME_SHARED_SECRET"),
  purposeId: requireEnv("SSMM_PURPOSE_ID"),
  purposeLabel: requireEnv("SSMM_PURPOSE_LABEL"),
  orientationId: requireEnv("SSMM_ORIENTATION_ID"),
  orientationLabel: requireEnv("SSMM_ORIENTATION_LABEL"),
  shape: {
    endpoint: requireEnv("SSMM_SHAPE_ENDPOINT"),
    apiKey: requireEnv("SSMM_SHAPE_API_KEY"),
    model: requireEnv("SSMM_SHAPE_MODEL"),
  },
});
