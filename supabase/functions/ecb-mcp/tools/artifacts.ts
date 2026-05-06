// Artifacts tools — canonical_artifacts, artifact_versions, artifact_chunks, artifact_links.
// 7 tools: create_artifact, get_artifact, search_artifacts, list_artifacts,
//          update_artifact, approve_artifact, link_artifact.
//
// Governance invariant (OB1): agent-written artifacts start as draft/evidence.
// current_version_id is only set by approve_artifact — never by create/update.
// search_artifacts defaults to approved versions only; include_drafts=true for review.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

// ─── SHA-256 checksum (Web Crypto — available in Deno Edge Functions) ─────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Code-fence-aware markdown chunker ───────────────────────────────────────
// Splits body by H1/H2/H3 headers (skipping headers inside ``` fences).
// Falls back to paragraph splitting. Applies sliding-window for oversized paragraphs.
// Returns raw chunks; caller prefixes for embedding separately.
interface RawChunk {
  section_title: string | null;
  section_path: string;
  content: string;
  chunk_index: number;
}

function chunkMarkdown(body: string, artifactTitle: string): RawChunk[] {
  const MAX_CHARS = 2000;
  const lines = body.split("\n");

  let inFence = false;
  // headerStack[0]=h1, [1]=h2, [2]=h3 — last seen at each depth
  const headerStack: (string | null)[] = [null, null, null];

  interface Section { title: string | null; path: string; rawLines: string[] }
  const sections: Section[] = [];
  let cur: Section = { title: null, path: artifactTitle, rawLines: [] };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      cur.rawLines.push(line);
      continue;
    }
    if (!inFence) {
      const m = line.match(/^(#{1,3})\s+(.+)$/);
      if (m) {
        const content = cur.rawLines.join("\n").trim();
        if (content) sections.push(cur);
        const level = m[1].length;
        const title = m[2].trim();
        headerStack[level - 1] = title;
        for (let i = level; i < 3; i++) headerStack[i] = null;
        const path = headerStack.filter(Boolean).join(" > ");
        cur = { title, path, rawLines: [] };
        continue;
      }
    }
    cur.rawLines.push(line);
  }
  const finalContent = cur.rawLines.join("\n").trim();
  if (finalContent) sections.push(cur);

  // No headers found — treat whole body as one section
  if (sections.length === 0) {
    sections.push({ title: null, path: artifactTitle, rawLines: body.split("\n") });
  }

  const chunks: RawChunk[] = [];
  let idx = 0;

  for (const section of sections) {
    const content = section.rawLines.join("\n").trim();
    if (!content) continue;

    if (content.length <= MAX_CHARS) {
      chunks.push({ section_title: section.title, section_path: section.path, content, chunk_index: idx++ });
      continue;
    }

    // Split by paragraphs
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
    let acc = "";

    for (const para of paragraphs) {
      if (para.length > MAX_CHARS) {
        // Flush accumulator
        if (acc.trim()) {
          chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ });
          acc = "";
        }
        // Sliding window
        const win = 1800; const overlap = 200;
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + win, para.length);
          chunks.push({ section_title: section.title, section_path: section.path, content: para.slice(start, end), chunk_index: idx++ });
          if (end === para.length) break;
          start += win - overlap;
        }
      } else if (acc && (acc + "\n\n" + para).length > MAX_CHARS) {
        chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ });
        acc = para;
      } else {
        acc = acc ? acc + "\n\n" + para : para;
      }
    }
    if (acc.trim()) {
      chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ });
    }
  }

  return chunks;
}

// ─── Internal: embed + insert chunks for a given artifact version ─────────────
async function chunkAndStore(
  supabase: Parameters<RegisterFn>[1],
  getEmbedding: (t: string) => Promise<number[]>,
  artifactId: string,
  versionId: string,
  body: string,
  artifactTitle: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const rawChunks = chunkMarkdown(body, artifactTitle);
  const rows = [];

  for (const chunk of rawChunks) {
    // Prefix before embedding only — raw content stored in DB
    const prefixed = `Artifact: ${artifactTitle}\nSection: ${chunk.section_path}\n\n${chunk.content}`;
    try {
      const embedding = await getEmbedding(prefixed);
      rows.push({
        artifact_id: artifactId,
        version_id: versionId,
        section_title: chunk.section_title,
        section_path: chunk.section_path,
        content: chunk.content,
        chunk_index: chunk.chunk_index,
        embedding,
      });
    } catch (err: unknown) {
      return { ok: false, count: rows.length, error: `Embedding failed at chunk ${chunk.chunk_index}: ${(err as Error).message}` };
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("artifact_chunks").insert(rows);
    if (error) return { ok: false, count: 0, error: `Chunk insert failed: ${error.message}` };
  }

  return { ok: true, count: rows.length };
}

// ─── Module registration ──────────────────────────────────────────────────────
export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { getEmbedding } = helpers;

  // ── Tool 1: create_artifact ────────────────────────────────────────────────
  registrar.registerTool(
    "create_artifact",
    {
      title: "Create Artifact",
      description:
        "Create a canonical artifact with its first version and run the chunking pipeline. authority_level defaults to 'draft' — agent-written artifacts must be explicitly approved via approve_artifact before becoming active instructions (current_version_id is set only on approval).",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        title:           z.string().describe("Artifact title"),
        doc_type:        z.enum(["prompt","template","checklist","prd","spec","sop","playbook","agent_context","agent_handoff","agent_instruction","runtime_policy","repo_context"]),
        body:            z.string().describe("Full document content"),
        summary:         z.string().optional().describe("One-sentence description — what this artifact is and when to use it"),
        domain:          z.string().optional().describe("Operational domain (ecos-architecture, tango-pedagogy, etc.)"),
        scope:           z.enum(["global","project","repo","client","domain","task"]).optional().default("project"),
        target_runtime:  z.string().optional().default("any").describe("Runtime convention: claude_code, claude_desktop, chatgpt, cursor, any"),
        source_path:     z.string().optional().describe("File system path if backed by a file — used for dedup detection"),
        authority_level: z.enum(["evidence","draft","proposed_instruction","approved_instruction","policy"]).optional().default("draft"),
        maintained_by:   z.enum(["human","agent","mixed","imported"]).optional().default("agent"),
        tags:            z.array(z.string()).optional(),
      },
    },
    async ({ title, doc_type, body, summary, domain, scope, target_runtime, source_path, authority_level, maintained_by, tags }) => {
      try {
        const checksum = await sha256(body);

        // Dedup: if source_path is known and checksum unchanged, skip
        if (source_path) {
          const { data: existing } = await supabase
            .from("canonical_artifacts")
            .select("id, latest_version_id")
            .eq("source_path", source_path)
            .maybeSingle();
          if (existing?.latest_version_id) {
            const { data: latestV } = await supabase
              .from("artifact_versions")
              .select("checksum")
              .eq("id", existing.latest_version_id)
              .maybeSingle();
            if ((latestV as { checksum: string } | null)?.checksum === checksum) {
              return { content: [{ type: "text" as const, text: `Artifact already exists at ${source_path} with identical content (ID: ${existing.id}) — no new version created.` }] };
            }
          }
        }

        // Insert canonical_artifacts row
        const { data: artRow, error: artErr } = await supabase
          .from("canonical_artifacts")
          .insert({
            title, doc_type,
            summary: summary ?? null,
            domain: domain ?? null,
            scope: scope ?? "project",
            target_runtime: target_runtime ?? "any",
            source_path: source_path ?? null,
            authority_level: authority_level ?? "draft",
            maintained_by: maintained_by ?? "agent",
            tags: tags ?? [],
          })
          .select("id")
          .single();
        if (artErr || !artRow) {
          return { content: [{ type: "text" as const, text: `Failed to create artifact: ${artErr?.message ?? "no row"}` }], isError: true };
        }

        // Insert first version (chunking_status: pending)
        const { data: verRow, error: verErr } = await supabase
          .from("artifact_versions")
          .insert({
            artifact_id: (artRow as { id: string }).id,
            version_number: 1,
            body,
            change_note: "Initial version",
            created_by: "agent",
            review_status: "unreviewed",
            chunking_status: "pending",
            checksum,
          })
          .select("id")
          .single();
        if (verErr || !verRow) {
          return { content: [{ type: "text" as const, text: `Artifact created (${(artRow as { id: string }).id}) but version insert failed: ${verErr?.message ?? "no row"}` }], isError: true };
        }

        const artId = (artRow as { id: string }).id;
        const verId = (verRow as { id: string }).id;

        // Run chunking pipeline
        const chunking = await chunkAndStore(supabase, getEmbedding, artId, verId, body, title);

        // Update version chunking_status
        await supabase.from("artifact_versions").update(
          chunking.ok
            ? { chunking_status: "complete", chunk_count: chunking.count }
            : { chunking_status: "failed", chunking_error: chunking.error },
        ).eq("id", verId);

        // Set latest_version_id only (current_version_id requires approve_artifact)
        await supabase.from("canonical_artifacts").update({ latest_version_id: verId }).eq("id", artId);

        if (!chunking.ok) {
          return { content: [{ type: "text" as const, text: `Artifact ${artId} and version ${verId} created, but chunking failed: ${chunking.error}` }], isError: true };
        }

        return {
          content: [{
            type: "text" as const,
            text: [
              `Created artifact ${artId}`,
              `  Title: ${title} [${doc_type}]`,
              `  Authority: ${authority_level ?? "draft"} | Scope: ${scope ?? "project"}`,
              `  Version: ${verId} (v1) — ${chunking.count} chunk(s)`,
              `  Status: draft. Call approve_artifact with new_authority_level to make this searchable by default.`,
            ].join("\n"),
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 2: get_artifact ───────────────────────────────────────────────────
  registrar.registerTool(
    "get_artifact",
    {
      title: "Get Artifact",
      description: "Retrieve a canonical artifact with version history and (optionally) the current approved body. If no version is approved yet, returns the latest draft body.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        artifact_id:  z.string().uuid(),
        include_body: z.boolean().optional().default(true).describe("Include full document body (default true)"),
      },
    },
    async ({ artifact_id, include_body }) => {
      try {
        const { data: art, error: artErr } = await supabase
          .from("canonical_artifacts")
          .select("*")
          .eq("id", artifact_id)
          .single();
        if (artErr || !art) {
          return { content: [{ type: "text" as const, text: `Artifact not found: ${artErr?.message ?? "no row"}` }], isError: true };
        }

        const { data: versions } = await supabase
          .from("artifact_versions")
          .select("id, version_number, review_status, chunking_status, chunk_count, change_note, created_by, created_at")
          .eq("artifact_id", artifact_id)
          .order("version_number", { ascending: false });

        type ArtRow = { id: string; title: string; doc_type: string; authority_level: string; review_status: string; scope: string; target_runtime: string; maintained_by: string; summary: string | null; source_path: string | null; current_version_id: string | null; latest_version_id: string | null; tags: string[]; created_at: string; updated_at: string };
        const a = art as ArtRow;

        const lines = [
          `## ${a.title}`,
          `ID: ${a.id}`,
          `Type: ${a.doc_type} | Authority: ${a.authority_level} | Review: ${a.review_status}`,
          `Scope: ${a.scope} | Runtime: ${a.target_runtime} | Maintained by: ${a.maintained_by}`,
          a.summary ? `Summary: ${a.summary}` : null,
          a.source_path ? `Source: ${a.source_path}` : null,
          `Tags: ${(a.tags ?? []).join(", ") || "(none)"}`,
          `Current (approved) version: ${a.current_version_id ?? "none — not yet approved"}`,
          `Latest version: ${a.latest_version_id ?? "none"}`,
          `Created: ${new Date(a.created_at).toLocaleDateString()} | Updated: ${new Date(a.updated_at).toLocaleDateString()}`,
          "",
          `### Version history (${versions?.length ?? 0} version(s))`,
        ].filter(l => l !== null) as string[];

        type VerRow = { id: string; version_number: number; review_status: string; chunking_status: string; chunk_count: number | null; change_note: string | null; created_by: string; created_at: string };
        for (const v of (versions ?? []) as VerRow[]) {
          const isCurrent = v.id === a.current_version_id ? " ← CURRENT" : "";
          const chunkInfo = v.chunking_status === "complete" ? `${v.chunk_count ?? 0} chunk(s)` : `chunking: ${v.chunking_status}`;
          lines.push(`  v${v.version_number} [${v.review_status}] ${chunkInfo}${v.change_note ? " — " + v.change_note : ""}${isCurrent}`);
          lines.push(`    ID: ${v.id} | by ${v.created_by} | ${new Date(v.created_at).toLocaleDateString()}`);
        }

        if (include_body) {
          const targetId = a.current_version_id ?? a.latest_version_id;
          if (targetId) {
            const { data: vBody } = await supabase
              .from("artifact_versions")
              .select("body, version_number, review_status")
              .eq("id", targetId)
              .single();
            if (vBody) {
              type VBody = { body: string; version_number: number; review_status: string };
              const vb = vBody as VBody;
              const label = a.current_version_id ? "current approved" : "latest draft — not yet approved";
              lines.push("", `### Body (v${vb.version_number} — ${label})`, vb.body);
            }
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 3: search_artifacts ───────────────────────────────────────────────
  registrar.registerTool(
    "search_artifacts",
    {
      title: "Search Artifacts",
      description:
        "Semantic search across artifact chunks. Defaults to current approved complete versions only — safe for agent instruction retrieval. Set include_drafts=true for draft review. Returns chunk pointers with artifact metadata and provenance.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query:           z.string().describe("What to search for"),
        limit:           z.number().int().min(1).max(50).optional().default(10),
        threshold:       z.number().optional().default(0.38),
        doc_type:        z.string().optional().describe("Filter by doc_type (e.g. repo_context, agent_instruction)"),
        authority_level: z.string().optional().describe("Filter by authority_level"),
        scope:           z.string().optional().describe("Filter by scope"),
        include_drafts:  z.boolean().optional().default(false).describe("Include unapproved/draft versions (default false)"),
      },
    },
    async ({ query, limit, threshold, doc_type, authority_level, scope, include_drafts }) => {
      try {
        const qEmb = await getEmbedding(query);
        const { data, error } = await supabase.rpc("match_artifact_chunks", {
          query_embedding: qEmb,
          match_threshold: threshold ?? 0.38,
          match_count: limit ?? 10,
          filter_authority: authority_level ?? null,
          filter_doc_type: doc_type ?? null,
          filter_scope: scope ?? null,
          include_drafts: include_drafts ?? false,
        });
        if (error) {
          return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
        }
        if (!data?.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No artifact chunks found matching "${query}"${include_drafts ? "" : " in approved versions (try include_drafts=true to search drafts)"}.`,
            }],
          };
        }

        type ChunkResult = { chunk_id: string; artifact_id: string; version_id: string; section_title: string | null; section_path: string | null; content: string; chunk_index: number; similarity: number; artifact_title: string; doc_type: string; authority_level: string; review_status: string; scope: string; source_path: string | null };
        const results = (data as ChunkResult[]).map((r, i) => [
          `--- Result ${i + 1} (${(r.similarity * 100).toFixed(1)}% match) ---`,
          `Artifact: ${r.artifact_title} [${r.doc_type} · ${r.authority_level} · ${r.review_status}]`,
          `Section: ${r.section_path ?? "(root)"}`,
          r.source_path ? `Source: ${r.source_path}` : null,
          `IDs: artifact=${r.artifact_id} | version=${r.version_id} | chunk=${r.chunk_id}`,
          "",
          r.content,
        ].filter(l => l !== null).join("\n"));

        return { content: [{ type: "text" as const, text: results.join("\n\n") }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 4: list_artifacts ─────────────────────────────────────────────────
  registrar.registerTool(
    "list_artifacts",
    {
      title: "List Artifacts",
      description: "List canonical artifacts with optional filters. Returns headers with version/approval status.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        doc_type:        z.string().optional(),
        scope:           z.string().optional(),
        authority_level: z.string().optional(),
        target_runtime:  z.string().optional(),
        domain:          z.string().optional(),
        limit:           z.number().int().min(1).max(100).optional().default(20),
      },
    },
    async ({ doc_type, scope, authority_level, target_runtime, domain, limit }) => {
      try {
        let q = supabase
          .from("canonical_artifacts")
          .select("id, title, doc_type, authority_level, review_status, scope, target_runtime, domain, summary, current_version_id, latest_version_id, tags, updated_at")
          .order("updated_at", { ascending: false })
          .limit(limit ?? 20);
        if (doc_type) q = q.eq("doc_type", doc_type);
        if (scope) q = q.eq("scope", scope);
        if (authority_level) q = q.eq("authority_level", authority_level);
        if (target_runtime) q = q.eq("target_runtime", target_runtime);
        if (domain) q = q.eq("domain", domain);

        const { data, error } = await q;
        if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
        if (!data?.length) return { content: [{ type: "text" as const, text: "No artifacts found." }] };

        type ArtHeader = { id: string; title: string; doc_type: string; authority_level: string; review_status: string; scope: string; target_runtime: string; domain: string | null; summary: string | null; current_version_id: string | null; latest_version_id: string | null; tags: string[]; updated_at: string };
        const lines = [`${data.length} artifact(s):\n`];
        for (const a of data as ArtHeader[]) {
          lines.push(`• ${a.title} [${a.doc_type}]`);
          lines.push(`  Authority: ${a.authority_level} | Review: ${a.review_status} | Scope: ${a.scope}${a.domain ? " | " + a.domain : ""}`);
          if (a.summary) lines.push(`  ${a.summary}`);
          const approvedLabel = a.current_version_id ? "approved ✓" : "draft — not yet approved";
          lines.push(`  ID: ${a.id} | ${approvedLabel} | Updated: ${new Date(a.updated_at).toLocaleDateString()}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 5: update_artifact ────────────────────────────────────────────────
  registrar.registerTool(
    "update_artifact",
    {
      title: "Update Artifact",
      description:
        "Create a new draft version of an existing artifact with updated content. Re-chunks the new version. Does NOT update current_version_id — the existing approved version remains active. Call approve_artifact to promote the new version.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        artifact_id:  z.string().uuid(),
        body:         z.string().describe("New full document content"),
        change_note:  z.string().describe("What changed and why"),
        created_by:   z.string().optional().default("agent"),
      },
    },
    async ({ artifact_id, body, change_note, created_by }) => {
      try {
        const { data: art, error: artErr } = await supabase
          .from("canonical_artifacts")
          .select("title")
          .eq("id", artifact_id)
          .single();
        if (artErr || !art) {
          return { content: [{ type: "text" as const, text: `Artifact not found: ${artErr?.message ?? "no row"}` }], isError: true };
        }
        const artTitle = (art as { title: string }).title;
        const checksum = await sha256(body);

        // Next version number
        const { data: lastVer } = await supabase
          .from("artifact_versions")
          .select("version_number")
          .eq("artifact_id", artifact_id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextNum = ((lastVer as { version_number: number } | null)?.version_number ?? 0) + 1;

        // Insert new version as unreviewed draft
        const { data: verRow, error: verErr } = await supabase
          .from("artifact_versions")
          .insert({
            artifact_id,
            version_number: nextNum,
            body,
            change_note,
            created_by: created_by ?? "agent",
            review_status: "unreviewed",
            chunking_status: "pending",
            checksum,
          })
          .select("id")
          .single();
        if (verErr || !verRow) {
          return { content: [{ type: "text" as const, text: `Version insert failed: ${verErr?.message ?? "no row"}` }], isError: true };
        }
        const verId = (verRow as { id: string }).id;

        const chunking = await chunkAndStore(supabase, getEmbedding, artifact_id, verId, body, artTitle);

        await supabase.from("artifact_versions").update(
          chunking.ok
            ? { chunking_status: "complete", chunk_count: chunking.count }
            : { chunking_status: "failed", chunking_error: chunking.error },
        ).eq("id", verId);

        // Update latest_version_id only (NOT current_version_id)
        await supabase.from("canonical_artifacts").update({ latest_version_id: verId }).eq("id", artifact_id);

        if (!chunking.ok) {
          return { content: [{ type: "text" as const, text: `Version ${verId} (v${nextNum}) created but chunking failed: ${chunking.error}` }], isError: true };
        }

        return {
          content: [{
            type: "text" as const,
            text: [
              `Created draft version ${verId} (v${nextNum}) for artifact ${artifact_id}`,
              `  Chunks: ${chunking.count}`,
              `  Status: unreviewed draft. Previous approved version still active. Call approve_artifact to promote.`,
            ].join("\n"),
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 6: approve_artifact ───────────────────────────────────────────────
  registrar.registerTool(
    "approve_artifact",
    {
      title: "Approve Artifact",
      description:
        "Approve a specific artifact version and set it as the active current version. Requires new_authority_level — no default. Previous current version is marked superseded. Only approved complete versions are returned by search_artifacts by default.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        artifact_id:         z.string().uuid(),
        version_id:          z.string().uuid().describe("The version to approve and make current"),
        new_authority_level: z.enum(["evidence","draft","proposed_instruction","approved_instruction","policy"])
          .describe("Required — no default. evidence/draft: informational artifacts; proposed_instruction: pending review; approved_instruction: active agent context (CLAUDE.md-style); policy: system-level."),
      },
    },
    async ({ artifact_id, version_id, new_authority_level }) => {
      try {
        // Verify version belongs to this artifact and chunking is complete
        const { data: ver, error: verErr } = await supabase
          .from("artifact_versions")
          .select("id, version_number, chunking_status, review_status")
          .eq("id", version_id)
          .eq("artifact_id", artifact_id)
          .single();
        if (verErr || !ver) {
          return { content: [{ type: "text" as const, text: `Version not found or does not belong to artifact ${artifact_id}: ${verErr?.message ?? "no row"}` }], isError: true };
        }
        type VerCheck = { id: string; version_number: number; chunking_status: string; review_status: string };
        const v = ver as VerCheck;

        if (v.chunking_status !== "complete") {
          return { content: [{ type: "text" as const, text: `Cannot approve: version chunking_status is '${v.chunking_status}' — expected 'complete'. Fix chunking before approving.` }], isError: true };
        }

        // Get current artifact state
        const { data: art } = await supabase
          .from("canonical_artifacts")
          .select("current_version_id")
          .eq("id", artifact_id)
          .single();
        const prevCurrentId = (art as { current_version_id: string | null } | null)?.current_version_id;

        // Mark previous current as superseded (if different)
        if (prevCurrentId && prevCurrentId !== version_id) {
          await supabase.from("artifact_versions")
            .update({ review_status: "superseded" })
            .eq("id", prevCurrentId);
        }

        // Approve the target version
        const { error: approveErr } = await supabase.from("artifact_versions")
          .update({ review_status: "approved" })
          .eq("id", version_id);
        if (approveErr) {
          return { content: [{ type: "text" as const, text: `Failed to approve version: ${approveErr.message}` }], isError: true };
        }

        // Update artifact metadata
        const { error: artUpdateErr } = await supabase.from("canonical_artifacts")
          .update({ current_version_id: version_id, authority_level: new_authority_level, review_status: "approved" })
          .eq("id", artifact_id);
        if (artUpdateErr) {
          return { content: [{ type: "text" as const, text: `Version approved but artifact metadata update failed: ${artUpdateErr.message}` }], isError: true };
        }

        return {
          content: [{
            type: "text" as const,
            text: [
              `Approved version ${version_id} (v${v.version_number}) for artifact ${artifact_id}`,
              `  Authority level: ${new_authority_level}`,
              prevCurrentId && prevCurrentId !== version_id ? `  Previous current version → superseded` : "",
              `  This version is now searchable by default via search_artifacts.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 7: link_artifact ──────────────────────────────────────────────────
  registrar.registerTool(
    "link_artifact",
    {
      title: "Link Artifact",
      description: "Link a canonical artifact to a related thought, contact, entity, or opportunity. Builds provenance chains. Use relationship_type 'governs' for instruction artifacts that constrain other records.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        artifact_id:       z.string().uuid(),
        linked_type:       z.enum(["thought","contact","entity","opportunity"]),
        linked_id:         z.string().uuid(),
        relationship_type: z.enum(["governs","supplements","derived_from","implements","references"]),
        note:              z.string().optional(),
      },
    },
    async ({ artifact_id, linked_type, linked_id, relationship_type, note }) => {
      try {
        const { data, error } = await supabase
          .from("artifact_links")
          .insert({ artifact_id, linked_type, linked_id, relationship_type, note: note ?? null })
          .select("id")
          .single();
        if (error || !data) {
          return { content: [{ type: "text" as const, text: `Failed to create link: ${error?.message ?? "no row"}` }], isError: true };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Linked artifact ${artifact_id} → ${linked_type} ${linked_id} (${relationship_type}). Link ID: ${(data as { id: string }).id}`,
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
};
