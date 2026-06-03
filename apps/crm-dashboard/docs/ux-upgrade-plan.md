# crm-dashboard — UX Upgrade Plan (phased, multi-agent)

**Goal:** raise the dashboard UX, prioritizing (1) **artifacts review** and (2) **mobile**.
**Audience:** Claude Code *and* Codex, working the same repo. Read the Handoff Protocol before touching code.

Current-state assessment (2026-06-03): People Intel sets the polish bar (stat cards + color badges +
clean table). The **artifact detail page is the weakest screen** — block content renders as *raw,
unformatted markdown* (literal `##`, `**`, `-`), one long monochrome wall, no in-page nav. The
artifacts **list** lacks search/summary. Table-heavy pages likely overflow on mobile. The app is all
server-rendered (Next 14 App Router), Tailwind, no client components; data via the server-only
`lib/supabase-server.ts` client. The site is behind a Basic-Auth gate (`SITE_PASSWORD`).

---

## Status board (single source of truth — update this when you claim/finish a sprint)

| # | Sprint | Priority | Status | Owner | Commit |
|---|--------|----------|--------|-------|--------|
| 0 | Verification harness through the gate | enabler | DONE | Claude Code | 8737b5f |
| 1 | Markdown rendering in artifact blocks | artifacts | DONE | Claude Code | 7318e5c |
| 2 | Block sections + sticky TOC (artifact detail) | artifacts | DONE (Codex, b43edb0) | Codex | b43edb0 |
| 3 | Artifacts responsive / mobile | artifacts+mobile | DONE (Codex, 97d288c) | Codex | 97d288c |
| 4 | Artifacts list: search + summary header | artifacts | PENDING | — | — |
| 5 | App-wide mobile pass (table pages) | mobile | PENDING | — | — |
| 6 | Cross-app visual consistency (optional) | polish | PENDING | — | — |

Status values: `PENDING` · `IN PROGRESS (agent, date)` · `DONE (agent, sha)` · `BLOCKED (reason)`.

---

## Handoff Protocol (read first — prevents the same-repo collisions we hit)

1. **One sprint in flight at a time.** If any row is `IN PROGRESS`, do **not** start another — coordinate or wait.
2. **`git pull --rebase origin main`** before doing anything.
3. **Claim** the sprint: set its row to `IN PROGRESS (<agent>, <date>)`, commit *just this doc* to `main`, push. That commit is the lock the other agent sees.
4. **Branch:** `git checkout -b ux/sprint-<N>-<slug>` off latest `main`.
5. **Build exactly one sprint's "Definition of Done."** Don't bundle scope from other sprints.
6. **Verify** per the sprint's Verify steps (desktop **and** mobile screenshots via Sprint 0's driver; `npm test` green). Look at the screenshots.
7. **Land it:** commit, push the branch, fast-forward/merge to `main`, push `main`, `git pull`.
8. **Release the lock:** set the row to `DONE (<agent>, <sha>)`, commit this doc, push.
9. Next agent: pull, pick the next `PENDING` sprint whose deps are met, repeat.

Invariants: every sprint leaves `main` green (`npm test` + build). Never two `IN PROGRESS`. Always pull before start. Keep each PR to one sprint.

---

## Sprints

### Sprint 0 — Verification harness through the gate  *(enabler; do first)*
**One finished thing:** the `run-crm-dashboard` Playwright driver can screenshot the now-gated site, desktop and mobile.
- **Files:** `.claude/skills/run-crm-dashboard/driver.mjs`, `SKILL.md`.
- **Do:** when `SITE_PASSWORD` (or `BASIC_AUTH_PASSWORD`) env is set, create the Playwright context with `httpCredentials: { username: 'admin', password }`. Add a `--mobile` flag → iPhone-ish viewport (e.g. 390×844, `isMobile`, `deviceScaleFactor: 2`). Document both in SKILL.md.
- **Acceptance:** `SITE_PASSWORD=… node driver.mjs /artifacts` writes a non-401 screenshot; `--mobile` writes a 390px-wide one.
- **Verify:** run both; open the PNGs. **Deps:** none.

### Sprint 1 — Markdown rendering in artifact blocks  *(artifacts — highest impact)*
**One finished thing:** artifact block content renders as formatted markdown, not raw text.
- **Files:** `app/artifacts/[key]/page.tsx`; new `lib/markdown.tsx` (or component); `package.json`.
- **Do:** render block `content` with a markdown renderer (headings, bold, lists, code, tables, links). **Decision:** add `react-markdown` + `remark-gfm` (the one new dep — recommended; reversible). Style with Tailwind `prose`-style classes. Keep server-rendered.
- **Acceptance:** open `/artifacts/activation-preserving-assistance-operational-kernel` — headings/bold/lists/code render properly, no literal `##`/`**`; links clickable. Other doc kinds unaffected.
- **Verify:** desktop screenshot of that detail page; `npm test`. **Deps:** 0 (for verification).

### Sprint 2 — Block sections + sticky TOC  *(artifacts)*
**One finished thing:** a long artifact is navigable — visually separated blocks + a jump nav.
- **Files:** `app/artifacts/[key]/page.tsx` (+ small TOC component).
- **Do:** render each block as a distinct section (block path as a heading/anchor, subtle divider/card). Add a sticky table-of-contents listing block paths (`/overview`, `/current_state`, …) that jump to anchors. Revision history stays at the bottom, visually set off.
- **Acceptance:** on the kernel artifact, blocks are clearly separated; TOC lists all blocks and scrolls to them.
- **Verify:** desktop screenshot. **Deps:** 1 (build on the rendered detail).

### Sprint 3 — Artifacts responsive / mobile  *(artifacts + mobile)*
**One finished thing:** the artifacts list and detail are usable on a phone.
- **Files:** `app/artifacts/page.tsx`, `app/artifacts/[key]/page.tsx`, shared bits.
- **Do:** no horizontal overflow at 390px; list rows reflow (badges wrap sanely, date below title); detail TOC collapses to a top dropdown/disclosure on small screens; tap targets ≥ 40px.
- **Acceptance:** at 390px, `/artifacts` and a detail page have no horizontal scroll and are readable/tappable.
- **Verify:** `--mobile` screenshots of both. **Deps:** 1, 2.

### Sprint 4 — Artifacts list: search + summary header  *(artifacts)*
**One finished thing:** you can find an artifact fast.
- **Files:** `app/artifacts/page.tsx`.
- **Do:** add a text search (filter by title/key/summary — server-side via `?q=`, matching the BRAIN page's pattern). Add a compact summary header (total + counts by kind/status) à la People Intel. Tidy badge presentation/colors.
- **Acceptance:** `?q=tango` narrows the list; counts shown; kind pills still work.
- **Verify:** desktop + mobile screenshots; `npm test`. **Deps:** 0. (Independent of 1–3.)

### Sprint 5 — App-wide mobile pass (table pages)  *(mobile)*
**One finished thing:** the other table-heavy pages work on a phone.
- **Files:** `app/page.tsx` (Contacts), `app/people/page.tsx`, `app/it/page.tsx`, `app/follow-ups/page.tsx`, etc. (one PR may split per page if large).
- **Do:** tables become phone-friendly (responsive card layout on small screens, or a scoped horizontal-scroll container); nav wraps; stat cards stack.
- **Acceptance:** at 390px, Contacts + People have no broken layout / no full-page horizontal scroll.
- **Verify:** `--mobile` screenshots per page. **Deps:** 0. (If large, split into 5a/5b by page and add rows.)

### Sprint 6 — Cross-app visual consistency  *(optional polish; lowest priority)*
**One finished thing:** list pages share the People-Intel pattern (stat cards + color-coded badges + spacing/typography scale).
- **Files:** shared UI in `lib/` + per-page tweaks.
- **Acceptance:** Contacts/Artifacts/IT visually match the People-Intel bar.
- **Verify:** desktop + mobile screenshots. **Deps:** 3, 5 (do after mobile so layout is settled).

---

## Notes
- **Dep decision (Sprint 1):** `react-markdown` + `remark-gfm`. If you'd rather stay dependency-free, swap for a minimal server-side renderer — but the dep is the pragmatic choice and is isolated to one component.
- **Verification auth:** the site is gated; pass `SITE_PASSWORD` to the driver (Sprint 0 enables this). Screenshots land in `shots/` (gitignored).
- **Keep server-only:** do not introduce client components that import the supabase client; data stays server-rendered (preserves the security fix).
