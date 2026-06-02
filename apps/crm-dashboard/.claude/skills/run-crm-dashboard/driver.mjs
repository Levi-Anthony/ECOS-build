// driver.mjs — headless Playwright harness for the crm-dashboard Next.js app.
//
// The app must already be serving (see SKILL.md: `npm run dev`). This script
// does NOT launch Next — it drives the running app: navigates a route, waits
// for the data-driven content to render, writes a screenshot, and prints a
// machine-readable summary (title, visible nav, row counts, error/loading
// detection) so an agent can assert without eyeballing.
//
// Usage:
//   node driver.mjs [route] [outfile.png] [--click <selector>]
//   node driver.mjs                                   # "/"  -> shots/home.png
//   node driver.mjs /contacts                         #      -> shots/contacts.png
//   node driver.mjs all                               # screenshot every known route
//   node driver.mjs / shots/it.png --click 'button:has-text("IT")'   # click then shoot
//
// --click takes any Playwright selector; the click happens after first paint,
// then the script waits + re-screenshots so you capture the post-interaction
// state. row_like_elements before/after is your assertion handle.
//
// Env:
//   BASE_URL   (default http://localhost:3000)
//   HEADED=1   run headed (needs a display; default headless)

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// NOTE: "/" IS the contacts view (the "Contacts" nav link points to "/"). There is
// no "/contacts" index route — app/contacts/ only holds a [id] detail page, so
// "/contacts" returns 404. These are the real top-level pages (all 200):
const ROUTES = ["/", "/people", "/brain", "/briefings", "/follow-ups", "/taste", "/weekly", "/it"];

const slug = (r) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/\//g, "-"));

async function drive(page, route, outfile, click) {
  const url = BASE + route;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => ({ _err: e.message }));
  // Give client components a beat to hydrate + fetch from Supabase.
  await page.waitForTimeout(1500);
  let clicked = null;
  if (click) {
    const before = await page.locator("table tbody tr").count().catch(() => 0);
    await page.click(click, { timeout: 5000 });
    await page.waitForTimeout(800);
    const after = await page.locator("table tbody tr").count().catch(() => 0);
    clicked = { selector: click, rows_before: before, rows_after: after };
  }
  mkdirSync(dirname(outfile), { recursive: true });
  await page.screenshot({ path: outfile, fullPage: true });

  const title = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  const nav = await page.locator("nav a, header a").allInnerTexts().catch(() => []);
  const rows = await page.locator("table tbody tr, li, [class*=card]").count().catch(() => 0);
  const lower = bodyText.toLowerCase();
  const summary = {
    route,
    http: resp && resp.status ? resp.status() : (resp && resp._err) || "?",
    title,
    nav_links: [...new Set(nav)].slice(0, 12),
    row_like_elements: rows,
    looks_loading: /loading|spinner/.test(lower) && bodyText.length < 200,
    has_error: /application error|unhandled|cannot read|is not defined|500|stack trace/.test(lower),
    text_chars: bodyText.length,
    ...(clicked ? { clicked } : {}),
    screenshot: outfile,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// arg parsing: [route] [outfile] [--click <selector>]
const args = process.argv.slice(2);
const clickIdx = args.indexOf("--click");
const click = clickIdx >= 0 ? args.splice(clickIdx, 2)[1] : undefined;
const arg = args[0] ?? "/";
const out = args[1];
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  if (arg === "all") {
    for (const r of ROUTES) await drive(page, r, `shots/${slug(r)}.png`);
  } else {
    await drive(page, arg, out ?? `shots/${slug(arg)}.png`, click);
  }
} finally {
  await browser.close();
}
