// Backfill: existing thoughts with metadata.signal_type='taste' → taste_preferences rows.
// Parses Prompt-4 format (Preference Name | Domain | Reject | Want | Type), creates
// a structured taste_preferences row, and sets thoughts.metadata.taste_preference_id
// pointer for the reverse lookup.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bun run backfill_taste_preferences.ts --dry-run
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bun run backfill_taste_preferences.ts --commit
//
// Idempotent: skips rows already linked (metadata.taste_preference_id already set).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const dryRun = !process.argv.includes("--commit");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

type Thought = {
  id: string;
  content: string;
  original_content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ParsedFields = {
  preference_name?: string;
  domain?: string;
  reject?: string;
  want?: string;
  type_label?: string;
};

function parseTasteEntry(text: string): ParsedFields {
  // Strip optional TASTE:: prefix (case-insensitive)
  const stripped = text.replace(/^\s*TASTE::\s*/i, "").trim();

  // Locate the trailing-field markers (Domain → Reject → Want → Type).
  // The "name" section is everything before the first Domain: marker.
  const trailingMarkers: { key: keyof ParsedFields; label: RegExp }[] = [
    { key: "domain", label: /\bDomain:\s*/ },
    { key: "reject", label: /\bReject:\s*/ },
    { key: "want", label: /\bWant:\s*/ },
    { key: "type_label", label: /\bType:\s*/ },
  ];
  const positions = trailingMarkers.map((m) => {
    const match = m.label.exec(stripped);
    return match ? { key: m.key, start: match.index, end: match.index + match[0].length } : null;
  });

  // Need Domain: marker to anchor the name section.
  const domainPos = positions[0];
  if (!domainPos) return {};

  const fields: ParsedFields = {};

  // Extract the name section (everything before "Domain:")
  const nameSection = stripped.slice(0, domainPos.start).trim();
  // Strip a variety of name-marker prefixes: "Preference Name:", "Preference —",
  // "Taste preference —", "Taste profile —", and also handle the
  // "Taste profile — <header>. Preference Name: <name>" combo by using the
  // last "Preference Name:" or em-dash marker if multiple appear.
  const nameMatch = nameSection.match(
    /(?:Preference Name:|Preference\s*[—–-]|Taste\s+preference\s*[—–-]|Taste\s+profile\s*[—–-])\s*([\s\S]+?)\s*$/i,
  );
  if (nameMatch) {
    let name = nameMatch[1].trim();
    // Strip trailing period
    name = name.replace(/[.\s]+$/, "");
    // Strip parenthetical date suffix like "(March 2026)"
    name = name.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, "").trim();
    // If the captured name itself contains "Preference Name:" (combo header),
    // re-extract from the last such occurrence.
    const innerMatch = name.match(/Preference Name:\s*(.+)$/i);
    if (innerMatch) name = innerMatch[1].replace(/[.\s]+$/, "").trim();
    fields.preference_name = name || undefined;
  }

  // Extract the trailing fields (Domain, Reject, Want, Type) using marker positions
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    if (!cur) continue;
    const nextPos = positions.slice(i + 1).find((p) => p && p.start > cur.end);
    const sliceEnd = nextPos ? nextPos.start : stripped.length;
    let value = stripped.slice(cur.end, sliceEnd).trim();
    value = value.replace(/[.\s]+$/, "");
    fields[cur.key] = value || undefined;
  }

  return fields;
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN" : "COMMIT"}`);

  // Fetch all TASTE thoughts that aren't already linked
  const url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,original_content,metadata,created_at&metadata->>signal_type=eq.taste&metadata->taste_preference_id=is.null&order=created_at.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const thoughts: Thought[] = await res.json();
  console.log(`Found ${thoughts.length} TASTE thoughts to consider`);

  let parsed = 0;
  let skipped = 0;
  let inserted = 0;
  let failed = 0;

  for (const t of thoughts) {
    const text = t.original_content || t.content;
    const fields = parseTasteEntry(text);

    if (!fields.reject || !fields.want || !fields.type_label) {
      console.log(`  skip ${t.id} — missing required fields (preview: ${text.slice(0, 80)}...)`);
      skipped++;
      continue;
    }

    parsed++;
    const tasteRow = {
      user_id: "levi",
      preference_name: fields.preference_name ?? null,
      domain: fields.domain ?? (t.metadata.domain as string | undefined) ?? null,
      reject: fields.reject,
      want: fields.want,
      type_label: fields.type_label,
      constraint_text: text,
      source: "backfill_2026-05-04",
      status: "active",
      thought_id: t.id,
    };

    if (dryRun) {
      console.log(`  WOULD INSERT ${t.id}: name="${(fields.preference_name ?? "").slice(0, 60)}" type="${fields.type_label}"`);
      continue;
    }

    // Insert taste_preferences row
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/taste_preferences`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(tasteRow),
    });
    if (!insertRes.ok) {
      console.error(`  FAIL ${t.id}: ${insertRes.status} ${await insertRes.text()}`);
      failed++;
      continue;
    }
    const [insertedRow]: { id: string }[] = await insertRes.json();

    // Update thoughts.metadata pointer
    const newMeta = { ...t.metadata, taste_preference_id: insertedRow.id };
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${t.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: newMeta }),
    });
    if (!updateRes.ok) {
      console.error(`  PARTIAL ${t.id}: inserted ${insertedRow.id} but failed to update pointer: ${await updateRes.text()}`);
      failed++;
      continue;
    }

    inserted++;
    console.log(`  OK ${t.id} → ${insertedRow.id}`);
  }

  console.log(`\nDone. Parsed: ${parsed}, Skipped: ${skipped}, Inserted: ${inserted}, Failed: ${failed}`);
}

main();
