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

- Rotate the exposed Supabase service-role key in Supabase.
- Update deployment environment variables to remove `NEXT_PUBLIC_SUPABASE_ANON_KEY` and add `SUPABASE_SERVICE_ROLE_KEY`.
- Keep `NEXT_PUBLIC_SUPABASE_URL`; the project URL is not secret.

### Alternative remediations not chosen

- Or issue a real anon key and add explicit read-only RLS policies for the tables the
  dashboard needs.
