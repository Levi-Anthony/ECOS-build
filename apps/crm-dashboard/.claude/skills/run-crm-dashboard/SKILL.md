---
name: run-crm-dashboard
description: Build, launch, screenshot, and drive the ECOS CRM dashboard (apps/crm-dashboard) — the Next.js 14 web app showing contacts, people, BRAIN, follow-ups, taste, weekly, briefings. Use when asked to run, start, launch, serve, screenshot, drive, smoke-test, or visually verify the dashboard / crm-dashboard / ECOS Dashboard.
---

# Run: crm-dashboard

A **Next.js 14 (App Router)** dashboard that reads ECOS data from Supabase (browser
`@supabase/supabase-js` with the anon key in `.env.local`). It's driven headlessly by a
committed **Playwright** harness — `driver.mjs` — which navigates a route, waits for the
Supabase-backed content to render, writes a full-page screenshot to `shots/`, and prints a
JSON summary (HTTP status, title, nav, row counts, error/loading detection) so you can assert
without eyeballing.

> Paths below are relative to **`apps/crm-dashboard/`** (the unit). The driver lives at
> `.claude/skills/run-crm-dashboard/driver.mjs`.

## Prerequisites

- Node 20 (`node --version` → v20.x). macOS or Linux; **no system Chrome needed** — the harness
  uses Playwright's bundled chromium.
- App deps + harness (one-time):
  ```bash
  # from apps/crm-dashboard
  npm install
  # the driver is its own tiny package so it never touches the app's deps:
  cd .claude/skills/run-crm-dashboard && npm install && npx playwright install chromium && cd -
  ```

## Run (agent path) — launch, then drive

1. **Launch the dev server** (backgrounded; it detaches and keeps serving):
   ```bash
   # from apps/crm-dashboard
   npm run dev >/tmp/crm_dev.log 2>&1 &
   ```
2. **Wait until it's ready** (curl retries internally — no sleep needed):
   ```bash
   curl -s --retry 40 --retry-delay 1 --retry-all-errors --retry-connrefused \
     -o /dev/null -w "ready: HTTP %{http_code}\n" http://localhost:3000/
   ```
3. **Drive it** with the harness (from `apps/crm-dashboard`):
   ```bash
   # screenshot one route -> shots/home.png + JSON summary on stdout
   node .claude/skills/run-crm-dashboard/driver.mjs /

   # screenshot every real route -> shots/{home,people,brain,...}.png
   node .claude/skills/run-crm-dashboard/driver.mjs all

   # interact: click a filter chip, then screenshot the result.
   # filters are <a> links (server-side ?domain=), so use an anchor selector:
   node .claude/skills/run-crm-dashboard/driver.mjs / shots/tango.png --click 'a:has-text("Tango")'
   ```
   The `--click` run reports `rows_before`/`rows_after` so you can assert the filter changed the
   table (e.g. All=3 → Tango=1). Screenshots land in `apps/crm-dashboard/shots/` (gitignored).
   `cd` into the skill dir first if you prefer shorter paths — `cd .claude/skills/run-crm-dashboard && node driver.mjs /`.
4. **Stop the server** when done:
   ```bash
   lsof -ti tcp:3000 | xargs kill
   ```

## Run (human path)

```bash
npm run dev   # then open http://localhost:3000 — the home page IS the Contacts view
```
Useless headless (it just waits); use the agent path above to capture/verify.

## Test

```bash
npm test      # vitest run — 79 unit tests (lib/logic.ts aggregations, schema, helpers)
```
This is the layer most PRs touch (pure display/aggregation logic in `lib/`). Fast (<1s); run it
before the browser harness.

## Gotchas

- **`/` IS the Contacts page.** The "Contacts" nav link points to `/`. There is **no `/contacts`
  index** — `app/contacts/` only has a `[id]` detail page, so navigating to `/contacts` returns
  **404**. The driver's route list reflects this (8 real routes, all 200).
- **Filters are server-side, via URL.** The page is a Server Component that reads
  `searchParams.domain` and re-queries Supabase. The domain chips are **`<a href="/?domain=tango">`
  links, not buttons** — `button:has-text(...)` will time out. Click `a:has-text("Tango")` or just
  navigate to `/?domain=tango`.
- **Live Supabase data.** `.env.local` points at the real project (anon key, RLS-gated reads), so
  screenshots show real contacts/thoughts and row counts drift over time. There's no seed/fixture —
  assert on *structure* (columns, "N total", error/loading flags), not exact rows.
- **The dev server detaches.** `npm run dev … &` survives the shell that launched it; it won't stop
  on its own. Always kill it via `lsof -ti tcp:3000 | xargs kill`, not Ctrl-C.
- **`/brain` and `/taste` are large** (~29k chars of text) — full-page screenshots are tall; that's
  expected, not a hang.

## Troubleshooting

- **`page.click: Timeout … waiting for locator('button:has-text…')`** — the filter chips are `<a>`
  links, not buttons. Use `--click 'a:has-text("Tango")'`.
- **`curl` never returns 200 / connection refused** — server didn't start; check `/tmp/crm_dev.log`
  (port already in use → `lsof -ti tcp:3000 | xargs kill` first, or set `PORT=3001 npm run dev`).
- **`browserType.launch: Executable doesn't exist`** — chromium not installed; run
  `npx playwright install chromium` inside `.claude/skills/run-crm-dashboard`.
- **A route summary shows `"has_error": true`** — open the matching `shots/<route>.png`; it's a real
  runtime error in that page, not a harness problem.
