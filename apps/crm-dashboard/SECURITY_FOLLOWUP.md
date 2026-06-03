# Security Follow-up — crm-dashboard

## TICKET: Browser-exposed service-role Supabase key

**Severity:** High
**Status:** Open — pre-existing, surfaced (not introduced) by the Artifacts Review UI work.

### Finding

`apps/crm-dashboard/lib/supabase.ts` builds its single client from
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

### Possible remediations (out of scope for the Artifacts UI pass)

- Move all reads to a server-only Supabase client, with the service-role key in a
  non-public env var (no `NEXT_PUBLIC_` prefix), accessed only from Server Components /
  route handlers.
- Or issue a real anon key and add explicit read-only RLS policies for the tables the
  dashboard needs.
- Rotate the currently-exposed key once the refactor lands.

**Do not attempt the refactor as part of the Artifacts Review UI change.** This ticket is
the deliverable; the fix is a separate security task.
