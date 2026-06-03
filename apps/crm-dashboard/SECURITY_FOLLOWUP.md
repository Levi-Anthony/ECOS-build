# Security Follow-up — crm-dashboard

## TICKET: Browser-exposed service-role Supabase key

**Severity:** High
**Status:** Code remediation applied — key rotation still required.

### Finding

Previously, `apps/crm-dashboard/lib/supabase.ts` built its single client from
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Empirically, that "anon" key
is actually a **service-role key**: the `/brain` page renders real `thoughts` rows, and
`thoughts` is gated by an `auth.role() = 'service_role'` RLS policy that a plain anon/user
JWT could not pass. Anything in a `NEXT_PUBLIC_` env var is inlined into the client bundle,
so the service-role key ships to the browser — granting **full DB read/write to anyone who
loads the dashboard**.

The Artifacts Review UI does **not** widen this exposure: the artifact tables are already
reachable through that same key, and the new pages are read-only. The exposure exists
independently and predates this feature.

### Ticket text

> Replace browser-exposed service-role Supabase key with server-only access or an
> authenticated REST/session-cookie gateway. Do not keep service role in `NEXT_PUBLIC_`
> env vars.

### Remediation applied

- Runtime Supabase client creation moved to `apps/crm-dashboard/lib/supabase-server.ts`.
- The service-role key is now read from `SUPABASE_SERVICE_ROLE_KEY`, which is not public-prefixed.
- Server Component pages import the runtime client from the server-only module.
- Shared TypeScript types/constants remain in `apps/crm-dashboard/lib/supabase.ts` for tests and page rendering.

### Remaining required closeout

- Replace the exposed Supabase service-role key in Supabase. Current Supabase guidance is to create
  a new `sb_secret_...` key in Project Settings -> API Keys and use that in trusted server
  environments, then delete/disable the compromised legacy key once all server components are moved.
- Update deployment environment variables to remove `NEXT_PUBLIC_SUPABASE_ANON_KEY` and add
  `SUPABASE_SERVICE_ROLE_KEY` with the new server-only secret.
- Keep `NEXT_PUBLIC_SUPABASE_URL`; the project URL is not secret.
- Preview deployments intentionally do not need the server-only key at build time. If preview env vars
  are absent, the middleware fails closed unless `SITE_PASSWORD` is configured.

### Alternative remediations not chosen

- Or issue a real anon key and add explicit read-only RLS policies for the tables the
  dashboard needs.
