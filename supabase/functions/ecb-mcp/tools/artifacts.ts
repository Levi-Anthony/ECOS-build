// Artifacts tools — Artifact v2 (patch-based, block-addressable, versioned).
//
// Storage engine: artifacts / artifact_blocks / artifact_revisions /
// artifact_snapshots / artifact_block_embeddings (migration 20260602100000).
// The mutation primitive is patch_artifact (block-level ops + optimistic
// concurrency), not whole-body replacement. Full-body replace survives only as
// the admin/import/repair tool replace_artifact_body.
//
// Governance = audit-only: a patch applies live and is recorded as one immutable
// artifact_revisions row. There is no draft/approve gate (the old approve_artifact
// path is retired with v2).
//
// 12 tools: create_artifact, get_artifact (compat), get_artifact_manifest,
//   get_artifact_block, patch_artifact, search_artifacts, checkpoint_artifact,
//   get_artifact_snapshot, replace_artifact_body, list_artifacts, link_artifact,
//   reindex_artifact_embeddings.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { errorResult, textResult } from "../lib/format.ts";

type Supa = Parameters<RegisterFn>[1];
type GetEmbedding = (t: string) => Promise<number[]>;

const EMBED_SPLIT_THRESHOLD = 8000; // chars; larger blocks are chunked for embedding only

// ─── SHA-256 (Web Crypto) — hex of exact content; matches SQL encode(digest(...)) ─
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Code-fence-aware markdown chunker (embedding sub-chunks for oversized blocks
//     AND section detection for replace_artifact_body). Unchanged from v1. ────────
interface RawChunk { section_title: string | null; section_path: string; content: string; chunk_index: number }

function chunkMarkdown(body: string, artifactTitle: string): RawChunk[] {
  const MAX_CHARS = 2000;
  const lines = body.split("\n");
  let inFence = false;
  const headerStack: (string | null)[] = [null, null, null];
  interface Section { title: string | null; path: string; rawLines: string[] }
  const sections: Section[] = [];
  let cur: Section = { title: null, path: artifactTitle, rawLines: [] };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) { inFence = !inFence; cur.rawLines.push(line); continue; }
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
  if (sections.length === 0) sections.push({ title: null, path: artifactTitle, rawLines: body.split("\n") });

  const chunks: RawChunk[] = [];
  let idx = 0;
  for (const section of sections) {
    const content = section.rawLines.join("\n").trim();
    if (!content) continue;
    if (content.length <= MAX_CHARS) {
      chunks.push({ section_title: section.title, section_path: section.path, content, chunk_index: idx++ });
      continue;
    }
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
    let acc = "";
    for (const para of paragraphs) {
      if (para.length > MAX_CHARS) {
        if (acc.trim()) { chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ }); acc = ""; }
        const win = 1800, overlap = 200;
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + win, para.length);
          chunks.push({ section_title: section.title, section_path: section.path, content: para.slice(start, end), chunk_index: idx++ });
          if (end === para.length) break;
          start += win - overlap;
        }
      } else if (acc && (acc + "\n\n" + para).length > MAX_CHARS) {
        chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ }); acc = para;
      } else {
        acc = acc ? acc + "\n\n" + para : para;
      }
    }
    if (acc.trim()) chunks.push({ section_title: section.title, section_path: section.path, content: acc.trim(), chunk_index: idx++ });
  }
  return chunks;
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}
function deriveTitle(path: string): string {
  const seg = path.replace(/^\/+/, "").split("/").pop() || path;
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

interface ArtifactRow { id: string; key: string; title: string; kind: string; status: string; current_version: number; metadata: Record<string, unknown>; created_at: string; updated_at: string }
interface BlockRow { id: string; artifact_id: string; path: string; title: string | null; content: string; content_hash: string; version: number; sort_order: number; metadata: Record<string, unknown>; updated_at: string }

async function getArtifactByKey(supabase: Supa, key: string): Promise<ArtifactRow | null> {
  const { data } = await supabase.from("artifacts").select("*").eq("key", key).maybeSingle();
  return (data as ArtifactRow | null) ?? null;
}
async function getArtifactById(supabase: Supa, id: string): Promise<ArtifactRow | null> {
  const { data } = await supabase.from("artifacts").select("*").eq("id", id).maybeSingle();
  return (data as ArtifactRow | null) ?? null;
}

function isArchived(b: BlockRow): boolean {
  return (b.metadata as { status?: string } | null)?.status === "archived";
}

async function loadBlocks(supabase: Supa, artifactId: string, includeArchived: boolean): Promise<BlockRow[]> {
  const { data } = await supabase.from("artifact_blocks")
    .select("*").eq("artifact_id", artifactId)
    .order("sort_order", { ascending: true }).order("path", { ascending: true });
  const all = (data ?? []) as BlockRow[];
  return includeArchived ? all : all.filter(b => !isArchived(b));
}

// ─── Embedding service (changed-block-only regeneration) ──────────────────────
async function embedBlock(
  supabase: Supa, getEmbedding: GetEmbedding,
  artifact: { id: string; title: string }, block: { id?: string; path: string; title?: string | null; content: string },
): Promise<{ ok: boolean; count: number; error?: string }> {
  // Replace any existing embeddings for this block_path (handles chunk-count changes).
  await supabase.from("artifact_block_embeddings").delete().eq("artifact_id", artifact.id).eq("block_path", block.path);
  const content = (block.content ?? "").trim();
  if (!content) return { ok: true, count: 0 };

  const pieces = content.length <= EMBED_SPLIT_THRESHOLD
    ? [{ content, chunk_index: 0 }]
    : chunkMarkdown(content, block.title || deriveTitle(block.path)).map((c, i) => ({ content: c.content, chunk_index: i }));

  const rows = [];
  for (const p of pieces) {
    const prefixed = `Artifact: ${artifact.title}\nBlock: ${block.path}${block.title ? ` (${block.title})` : ""}\n\n${p.content}`;
    try {
      const embedding = await getEmbedding(prefixed);
      rows.push({ artifact_id: artifact.id, block_id: block.id ?? null, block_path: block.path, content: p.content, embedding, chunk_index: p.chunk_index });
    } catch (err: unknown) {
      return { ok: false, count: 0, error: `Embedding failed for ${block.path} chunk ${p.chunk_index}: ${(err as Error).message}` };
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("artifact_block_embeddings").insert(rows);
    if (error) return { ok: false, count: 0, error: `Embedding insert failed for ${block.path}: ${error.message}` };
  }
  return { ok: true, count: rows.length };
}

interface ChangedEntry { block_id?: string; path: string; old_path?: string; content?: string; action: "upsert" | "delete" | "rename" | "noembed" }

async function applyChangedEmbeddings(
  supabase: Supa, getEmbedding: GetEmbedding, artifact: { id: string; title: string }, changed: ChangedEntry[],
): Promise<string[]> {
  const warnings: string[] = [];
  for (const c of changed) {
    if (c.action === "noembed") continue;
    if (c.action === "delete") {
      await supabase.from("artifact_block_embeddings").delete().eq("artifact_id", artifact.id).eq("block_path", c.path);
      continue;
    }
    if (c.action === "rename" && c.old_path) {
      await supabase.from("artifact_block_embeddings").delete().eq("artifact_id", artifact.id).eq("block_path", c.old_path);
    }
    const res = await embedBlock(supabase, getEmbedding, artifact, { id: c.block_id, path: c.path, content: c.content ?? "" });
    if (!res.ok && res.error) warnings.push(res.error);
  }
  return warnings;
}

// ─── Compilation ──────────────────────────────────────────────────────────────
function compileMarkdown(a: ArtifactRow, blocks: BlockRow[]): string {
  const lines = [
    `# ${a.title}`, "",
    "Artifact key: `" + a.key + "`",
    `Version: ${a.current_version}`,
    `Kind: ${a.kind}`,
    `Updated: ${new Date(a.updated_at).toISOString().slice(0, 10)}`,
    "", "---", "",
  ];
  for (const b of blocks) {
    lines.push(`## ${b.title || deriveTitle(b.path)}`, "", b.content ?? "", "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function compileArtifact(supabase: Supa, a: ArtifactRow, format: "markdown" | "json", includeArchived: boolean): Promise<string> {
  const blocks = await loadBlocks(supabase, a.id, includeArchived);
  if (format === "json") {
    return JSON.stringify({ key: a.key, title: a.title, kind: a.kind, version: a.current_version,
      blocks: blocks.map(b => ({ path: b.path, title: b.title, content: b.content, hash: b.content_hash })) }, null, 2);
  }
  return compileMarkdown(a, blocks);
}

// Internal checkpoint: compile + store snapshot for current_version (idempotent unless force).
async function doCheckpoint(supabase: Supa, a: ArtifactRow, format: "markdown" | "json", includeArchived: boolean, force: boolean): Promise<{ created: boolean; version: number; content: string }> {
  const content = await compileArtifact(supabase, a, format, includeArchived);
  const hash = await sha256(content);
  const { data: existing } = await supabase.from("artifact_snapshots")
    .select("id").eq("artifact_id", a.id).eq("version", a.current_version).maybeSingle();
  if (existing && !force) return { created: false, version: a.current_version, content };
  await supabase.from("artifact_snapshots").upsert(
    { artifact_id: a.id, version: a.current_version, compiled_content: content, content_hash: hash, metadata: { format } },
    { onConflict: "artifact_id,version" },
  );
  return { created: true, version: a.current_version, content };
}

// Map RPC RAISE messages → user-facing patch errors (spec phrasings).
function formatPatchError(msg: string): string {
  if (msg.includes("VERSION_CONFLICT")) return `Patch rejected: ${msg.replace(/^.*VERSION_CONFLICT:\s*/, "")}. Fetch the manifest again and retry.`;
  if (msg.includes("HASH_CONFLICT")) return `Patch rejected: ${msg.replace(/^.*HASH_CONFLICT:\s*/, "")}`;
  if (msg.includes("MISSING_PATH")) return `Patch rejected: ${msg.replace(/^.*MISSING_PATH:\s*/, "")}`;
  if (msg.includes("PATH_EXISTS")) return `Patch rejected: ${msg.replace(/^.*PATH_EXISTS:\s*/, "")}`;
  if (msg.includes("ARTIFACT_NOT_FOUND")) return `Patch rejected: ${msg.replace(/^.*ARTIFACT_NOT_FOUND:\s*/, "")}`;
  return `Patch rejected: ${msg}`;
}

// ─── zod shapes ────────────────────────────────────────────────────────────────
const PatchOp = z.object({
  op: z.enum(["create_block", "replace_block", "append_block", "delete_block", "rename_block", "update_block_metadata"]),
  path: z.string().optional(),
  from_path: z.string().optional(),
  to_path: z.string().optional(),
  content: z.string().optional(),
  title: z.string().optional(),
  expected_hash: z.string().optional(),
  sort_order: z.number().int().optional(),
  create_if_missing: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  metadata_patch: z.record(z.string(), z.unknown()).optional(),
});
const BlockInput = z.object({
  path: z.string(),
  title: z.string().optional(),
  content: z.string(),
  sort_order: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Module registration ──────────────────────────────────────────────────────
export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { getEmbedding } = helpers;

  // ── create_artifact ────────────────────────────────────────────────────────
  registrar.registerTool(
    "create_artifact",
    {
      title: "Create Artifact",
      description:
        "Create a durable, addressable v2 artifact with a stable key and optional initial blocks. Returns version 1 if blocks are provided, else version 0. Block embeddings are generated for non-empty blocks. For active situation tracking use kind 'strategy_tracker'.",
      inputSchema: {
        key:            z.string().describe("Stable unique identifier, e.g. ttc_governance_strategy"),
        title:          z.string(),
        kind:           z.string().optional().default("document").describe("e.g. document, strategy_tracker, decision_log, prompt, spec, policy"),
        metadata:       z.record(z.string(), z.unknown()).optional(),
        blocks:         z.array(BlockInput).optional().describe("Initial blocks, each at a path like /overview, /current_state"),
        create_snapshot: z.boolean().optional().default(false),
      },
    },
    async ({ key, title, kind, metadata, blocks, create_snapshot }) => {
      try {
        const { data, error } = await supabase.rpc("create_artifact_v2", {
          p_key: key, p_title: title, p_kind: kind ?? "document",
          p_metadata: metadata ?? {}, p_blocks: blocks ?? [], p_actor: "mcp",
        });
        if (error) return errorResult(`Failed to create artifact: ${error.message}`);
        const res = data as { artifact_id: string; key: string; version: number; blocks: { block_id: string; path: string; content: string }[] };

        const warnings: string[] = [];
        for (const b of res.blocks ?? []) {
          const r = await embedBlock(supabase, getEmbedding, { id: res.artifact_id, title }, { id: b.block_id, path: b.path, content: b.content });
          if (!r.ok && r.error) warnings.push(r.error);
        }
        if (create_snapshot) {
          const a = await getArtifactById(supabase, res.artifact_id);
          if (a) await doCheckpoint(supabase, a, "markdown", false, false);
        }
        return textResult([
          `Created artifact "${res.key}" at version ${res.version} with ${(res.blocks ?? []).length} block(s).`,
          `  artifact_id: ${res.artifact_id}`,
          warnings.length ? `  ⚠ embedding warnings:\n   - ${warnings.join("\n   - ")}` : `  Block embeddings generated.`,
        ].join("\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── get_artifact_manifest ────────────────────────────────────────────────────
  registrar.registerTool(
    "get_artifact_manifest",
    {
      title: "Get Artifact Manifest",
      description:
        "Default first-read tool. Returns artifact identity, current_version, metadata, and the block index (path/title/hash/version/updated_at) WITHOUT dumping block content. Use the hashes and current_version when preparing a patch.",
      inputSchema: {
        key:              z.string(),
        include_archived: z.boolean().optional().default(false),
      },
    },
    async ({ key, include_archived }) => {
      try {
        const a = await getArtifactByKey(supabase, key);
        if (!a) return errorResult(`Artifact not found: ${key}`);
        const blocks = await loadBlocks(supabase, a.id, include_archived ?? false);
        const manifest = {
          key: a.key, title: a.title, kind: a.kind, status: a.status,
          current_version: a.current_version, metadata: a.metadata,
          blocks: blocks.map(b => ({
            path: b.path, title: b.title ?? deriveTitle(b.path),
            hash: b.content_hash, version: b.version, sort_order: b.sort_order,
            archived: isArchived(b) || undefined, updated_at: b.updated_at,
          })),
        };
        return textResult(JSON.stringify(manifest, null, 2));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── get_artifact_block ───────────────────────────────────────────────────────
  registrar.registerTool(
    "get_artifact_block",
    {
      title: "Get Artifact Block",
      description: "Read one or more specific blocks (exact content + content_hash + version). Call this before patching so you can pass expected_hash for each block you touch.",
      inputSchema: {
        key:   z.string(),
        paths: z.array(z.string()).describe("Block paths to read, e.g. ['/current_state','/decision_log']"),
      },
    },
    async ({ key, paths }) => {
      try {
        const a = await getArtifactByKey(supabase, key);
        if (!a) return errorResult(`Artifact not found: ${key}`);
        const { data } = await supabase.from("artifact_blocks").select("*").eq("artifact_id", a.id).in("path", paths);
        const found = (data ?? []) as BlockRow[];
        const out = paths.map(p => {
          const b = found.find(x => x.path === p);
          if (!b) return { path: p, error: "not found" };
          return { path: b.path, title: b.title, content: b.content, content_hash: b.content_hash, version: b.version, metadata: b.metadata, updated_at: b.updated_at };
        });
        return textResult(JSON.stringify({ key: a.key, current_version: a.current_version, blocks: out }, null, 2));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── patch_artifact ─────────────────────────────────────────────────────────
  registrar.registerTool(
    "patch_artifact",
    {
      title: "Patch Artifact",
      description:
        "Apply block-level patch operations atomically (all-or-nothing). Requires base_version (artifact-level optimistic lock) and, for each touched existing block, expected_hash (block-level optimistic lock). This is the NORMAL write path — never rewrite a whole document. Ops: create_block, replace_block, append_block (logs), delete_block, rename_block, update_block_metadata.",
      inputSchema: {
        key:             z.string(),
        base_version:    z.number().int().describe("Must equal the artifact's current_version (from the manifest)"),
        ops:             z.array(PatchOp).min(1),
        summary:         z.string().describe("Short human-readable summary of the change"),
        create_snapshot: z.boolean().optional().default(false),
        actor:           z.string().optional().default("mcp"),
      },
    },
    async ({ key, base_version, ops, summary, create_snapshot, actor }) => {
      try {
        const { data, error } = await supabase.rpc("apply_artifact_patch", {
          p_key: key, p_base_version: base_version, p_ops: ops,
          p_summary: summary, p_actor: actor ?? "mcp", p_metadata: {}, p_admin: false,
        });
        if (error) return errorResult(formatPatchError(error.message));
        const res = data as { artifact_id: string; key: string; old_version: number; new_version: number; changed_paths: string[]; changed: ChangedEntry[] };

        const a = await getArtifactById(supabase, res.artifact_id);
        const warnings = a ? await applyChangedEmbeddings(supabase, getEmbedding, { id: a.id, title: a.title }, res.changed ?? []) : [];
        if (create_snapshot && a) {
          const fresh = await getArtifactById(supabase, res.artifact_id);
          if (fresh) await doCheckpoint(supabase, fresh, "markdown", false, false);
        }
        return textResult(JSON.stringify({
          key: res.key, old_version: res.old_version, new_version: res.new_version,
          changed_paths: res.changed_paths, summary,
          ...(warnings.length ? { embedding_warnings: warnings } : {}),
        }, null, 2));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── search_artifacts ─────────────────────────────────────────────────────────
  registrar.registerTool(
    "search_artifacts",
    {
      title: "Search Artifacts",
      description: "Block-level semantic search across artifacts. Returns matching blocks with artifact key, block path, title, similarity, and a content excerpt — not whole documents. Filter by kind or a single artifact key.",
      inputSchema: {
        query:     z.string(),
        limit:     z.number().int().min(1).max(50).optional().default(10),
        threshold: z.number().optional().default(0.38),
        kind:      z.string().optional(),
        key:       z.string().optional(),
      },
    },
    async ({ query, limit, threshold, kind, key }) => {
      try {
        const qEmb = await getEmbedding(query);
        const { data, error } = await supabase.rpc("match_artifact_blocks", {
          query_embedding: qEmb, match_threshold: threshold ?? 0.38, match_count: limit ?? 10,
          filter_kind: kind ?? null, filter_key: key ?? null,
        });
        if (error) return errorResult(`Search error: ${error.message}`);
        type R = { artifact_key: string; artifact_title: string; kind: string; block_path: string; block_title: string | null; content: string; similarity: number };
        const rows = (data ?? []) as R[];
        if (!rows.length) return textResult(`No artifact blocks found matching "${query}".`);
        const out = rows.map((r, i) => [
          `--- Result ${i + 1} (${(r.similarity * 100).toFixed(1)}% match) ---`,
          `Artifact: ${r.artifact_title} [${r.kind}] (key: ${r.artifact_key})`,
          `Block: ${r.block_path}${r.block_title ? ` — ${r.block_title}` : ""}`,
          "",
          r.content.length > 600 ? r.content.slice(0, 600) + " …" : r.content,
        ].join("\n"));
        return textResult(out.join("\n\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── checkpoint_artifact ──────────────────────────────────────────────────────
  registrar.registerTool(
    "checkpoint_artifact",
    {
      title: "Checkpoint Artifact",
      description: "Compile the current blocks into a full snapshot stored at the current version. Idempotent for a given version unless force=true.",
      inputSchema: {
        key:              z.string(),
        format:           z.enum(["markdown", "json"]).optional().default("markdown"),
        include_archived: z.boolean().optional().default(false),
        force:            z.boolean().optional().default(false),
      },
    },
    async ({ key, format, include_archived, force }) => {
      try {
        const a = await getArtifactByKey(supabase, key);
        if (!a) return errorResult(`Artifact not found: ${key}`);
        const r = await doCheckpoint(supabase, a, format ?? "markdown", include_archived ?? false, force ?? false);
        return textResult(r.created
          ? `Snapshot created for "${key}" at version ${r.version} (${r.content.length} chars).`
          : `Snapshot already exists for "${key}" at version ${r.version} (pass force=true to recompile).`);
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── get_artifact_snapshot ────────────────────────────────────────────────────
  registrar.registerTool(
    "get_artifact_snapshot",
    {
      title: "Get Artifact Snapshot",
      description: "Read a compiled full-document snapshot. Returns the requested version, or the latest stored snapshot, or compiles current blocks on demand if no snapshot exists.",
      inputSchema: {
        key:     z.string(),
        version: z.number().int().optional(),
      },
    },
    async ({ key, version }) => {
      try {
        const a = await getArtifactByKey(supabase, key);
        if (!a) return errorResult(`Artifact not found: ${key}`);
        let q = supabase.from("artifact_snapshots").select("version, compiled_content").eq("artifact_id", a.id);
        q = version != null ? q.eq("version", version) : q.order("version", { ascending: false }).limit(1);
        const { data } = await q.maybeSingle();
        const snap = data as { version: number; compiled_content: string } | null;
        if (snap) return textResult(`# Snapshot v${snap.version}\n\n${snap.compiled_content}`);
        if (version != null) return errorResult(`No snapshot for "${key}" at version ${version}.`);
        const compiled = await compileArtifact(supabase, a, "markdown", false);
        return textResult(`# Compiled on demand (no stored snapshot) — v${a.current_version}\n\n${compiled}`);
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── get_artifact (compatibility read wrapper) ────────────────────────────────
  registrar.registerTool(
    "get_artifact",
    {
      title: "Get Artifact (compat)",
      description: "Compatibility read: returns artifact header + the compiled current body. Accepts a key or a legacy artifact_id (UUID). For editing, prefer get_artifact_manifest + get_artifact_block.",
      inputSchema: {
        key:          z.string().optional(),
        artifact_id:  z.string().uuid().optional(),
        include_body: z.boolean().optional().default(true),
      },
    },
    async ({ key, artifact_id, include_body }) => {
      try {
        const a = key ? await getArtifactByKey(supabase, key) : artifact_id ? await getArtifactById(supabase, artifact_id) : null;
        if (!a) return errorResult("Artifact not found (provide key or artifact_id).");
        const header = [
          `## ${a.title}`, `key: ${a.key} | id: ${a.id}`,
          `Kind: ${a.kind} | Status: ${a.status} | Version: ${a.current_version}`,
          `Updated: ${new Date(a.updated_at).toLocaleDateString()}`,
        ];
        if (include_body ?? true) header.push("", await compileArtifact(supabase, a, "markdown", false));
        return textResult(header.join("\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── list_artifacts ───────────────────────────────────────────────────────────
  registrar.registerTool(
    "list_artifacts",
    {
      title: "List Artifacts",
      description: "List v2 artifacts with optional filters (kind, status). Returns headers with key/title/kind/version.",
      inputSchema: {
        kind:   z.string().optional(),
        status: z.string().optional(),
        limit:  z.number().int().min(1).max(100).optional().default(20),
      },
    },
    async ({ kind, status, limit }) => {
      try {
        let q = supabase.from("artifacts").select("id, key, title, kind, status, current_version, metadata, updated_at")
          .order("updated_at", { ascending: false }).limit(limit ?? 20);
        if (kind) q = q.eq("kind", kind);
        if (status) q = q.eq("status", status);
        const { data, error } = await q;
        if (error) return errorResult(`Error: ${error.message}`);
        const rows = (data ?? []) as ArtifactRow[];
        if (!rows.length) return textResult("No artifacts found.");
        const lines = [`${rows.length} artifact(s):\n`];
        for (const a of rows) {
          lines.push(`• ${a.title} [${a.kind}] — key: ${a.key}`);
          lines.push(`  v${a.current_version} | ${a.status} | Updated: ${new Date(a.updated_at).toLocaleDateString()}`);
        }
        return textResult(lines.join("\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── link_artifact ────────────────────────────────────────────────────────────
  registrar.registerTool(
    "link_artifact",
    {
      title: "Link Artifact",
      description: "Link an artifact to a related thought, contact, entity, or opportunity (provenance chains). Accepts a key or a legacy artifact_id.",
      inputSchema: {
        key:               z.string().optional(),
        artifact_id:       z.string().uuid().optional(),
        linked_type:       z.enum(["thought", "contact", "entity", "opportunity"]),
        linked_id:         z.string().uuid(),
        relationship_type: z.enum(["governs", "supplements", "derived_from", "implements", "references"]),
        note:              z.string().optional(),
      },
    },
    async ({ key, artifact_id, linked_type, linked_id, relationship_type, note }) => {
      try {
        const a = key ? await getArtifactByKey(supabase, key) : artifact_id ? await getArtifactById(supabase, artifact_id) : null;
        if (!a) return errorResult("Artifact not found (provide key or artifact_id).");
        const { data, error } = await supabase.from("artifact_links")
          .insert({ artifact_id: a.id, linked_type, linked_id, relationship_type, note: note ?? null })
          .select("id").single();
        if (error || !data) return errorResult(`Failed to create link: ${error?.message ?? "no row"}`);
        return textResult(`Linked artifact ${a.key} → ${linked_type} ${linked_id} (${relationship_type}). Link ID: ${(data as { id: string }).id}`);
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── replace_artifact_body (ADMIN / IMPORT / REPAIR ONLY) ─────────────────────
  registrar.registerTool(
    "replace_artifact_body",
    {
      title: "Replace Artifact Body (admin/import only)",
      description:
        "⚠ DANGEROUS / NOT THE NORMAL WRITE PATH. Replaces the entire artifact body, reconciling it into blocks by heading. Requires an explicit mode (admin_import|migration|repair). For normal updates use patch_artifact with block-level ops.",
      inputSchema: {
        key:          z.string(),
        base_version: z.number().int(),
        body:         z.string(),
        summary:      z.string(),
        mode:         z.enum(["admin_import", "migration", "repair"]),
      },
    },
    async ({ key, base_version, body, summary, mode }) => {
      try {
        const a = await getArtifactByKey(supabase, key);
        if (!a) return errorResult(`Artifact not found: ${key}`);

        // Split body into flat heading sections → block paths; fallback /body.
        const newBlocks = splitBodyIntoBlocks(body);
        const current = await loadBlocks(supabase, a.id, false);
        const currentPaths = new Set(current.map(b => b.path));
        const newPaths = new Set(newBlocks.map(b => b.path));

        const ops: Record<string, unknown>[] = [];
        for (const nb of newBlocks) {
          ops.push(currentPaths.has(nb.path)
            ? { op: "replace_block", path: nb.path, content: nb.content, title: nb.title }
            : { op: "create_block", path: nb.path, content: nb.content, title: nb.title });
        }
        for (const cp of currentPaths) if (!newPaths.has(cp)) ops.push({ op: "delete_block", path: cp });

        const { data, error } = await supabase.rpc("apply_artifact_patch", {
          p_key: key, p_base_version: base_version, p_ops: ops,
          p_summary: `[${mode}] ${summary}`, p_actor: "admin", p_metadata: { mode }, p_admin: true,
        });
        if (error) return errorResult(formatPatchError(error.message));
        const res = data as { artifact_id: string; new_version: number; changed_paths: string[]; changed: ChangedEntry[] };

        const warnings = await applyChangedEmbeddings(supabase, getEmbedding, { id: a.id, title: a.title }, res.changed ?? []);
        const fresh = await getArtifactById(supabase, res.artifact_id);
        if (fresh) await doCheckpoint(supabase, fresh, "markdown", false, true);
        return textResult([
          `[${mode}] Replaced body of "${key}" → version ${res.new_version}.`,
          `  Blocks now: ${newBlocks.map(b => b.path).join(", ")}`,
          `  Changed: ${res.changed_paths.join(", ")}`,
          `  Snapshot created.`,
          warnings.length ? `  ⚠ embedding warnings:\n   - ${warnings.join("\n   - ")}` : "",
        ].filter(Boolean).join("\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );

  // ── reindex_artifact_embeddings (sweep / repair) ─────────────────────────────
  registrar.registerTool(
    "reindex_artifact_embeddings",
    {
      title: "Reindex Artifact Embeddings",
      description: "Regenerate block embeddings in CONVERGING BATCHES. By default (only_missing=true) it skips blocks that already have embeddings and embeds up to `limit` of the rest, reporting how many remain — re-run until it reports 0. Large corpora MUST be swept this way because each call embeds synchronously within one request and a full sweep exceeds the edge wall-clock. Scope to one artifact (key) or one block (key+path); only_missing=false forces re-embedding.",
      inputSchema: {
        key:          z.string().optional(),
        path:         z.string().optional(),
        limit:        z.number().int().min(1).max(2000).optional().default(25),
        only_missing: z.boolean().optional().default(true),
      },
    },
    async ({ key, path, limit, only_missing }) => {
      try {
        const onlyMissing = only_missing ?? true;
        const cap = limit ?? 25;
        const titles = new Map<string, string>(); // artifact_id → title
        let blocksQ = supabase.from("artifact_blocks").select("id, artifact_id, path, title, content, metadata");
        if (key) {
          const a = await getArtifactByKey(supabase, key);
          if (!a) return errorResult(`Artifact not found: ${key}`);
          titles.set(a.id, a.title);
          blocksQ = blocksQ.eq("artifact_id", a.id);
          if (path) blocksQ = blocksQ.eq("path", path);
        } else {
          blocksQ = blocksQ.limit(2000); // candidate ceiling for a sweep
        }
        const { data, error } = await blocksQ;
        if (error) return errorResult(`Error: ${error.message}`);
        let candidates = ((data ?? []) as BlockRow[]).filter(b => !isArchived(b));

        // Skip blocks that already have embeddings so repeated capped calls converge.
        if (onlyMissing) {
          const { data: emb } = await supabase.from("artifact_block_embeddings").select("artifact_id, block_path");
          const have = new Set(((emb ?? []) as { artifact_id: string; block_path: string }[]).map(e => `${e.artifact_id}:${e.block_path}`));
          candidates = candidates.filter(b => !have.has(`${b.artifact_id}:${b.path}`));
        }

        const missingTotal = candidates.length;
        const batch = candidates.slice(0, cap);
        let embedded = 0; const warnings: string[] = [];
        for (const b of batch) {
          let title = titles.get(b.artifact_id);
          if (!title) { const a = await getArtifactById(supabase, b.artifact_id); title = a?.title ?? ""; titles.set(b.artifact_id, title); }
          const r = await embedBlock(supabase, getEmbedding, { id: b.artifact_id, title }, { id: b.id, path: b.path, title: b.title, content: b.content });
          if (r.ok) embedded += 1; else if (r.error) warnings.push(r.error);
        }
        const remaining = onlyMissing ? Math.max(0, missingTotal - embedded) : 0;
        return textResult([
          `Reindexed ${embedded} block(s)${key ? ` for "${key}"` : " (sweep)"}.`,
          onlyMissing ? (remaining > 0 ? `${remaining} block(s) still missing embeddings — re-run to continue.` : "All targeted blocks now embedded.") : "",
          warnings.length ? `⚠ warnings:\n - ${warnings.join("\n - ")}` : "",
        ].filter(Boolean).join("\n"));
      } catch (err: unknown) {
        return errorResult(`Error: ${(err as Error).message}`);
      }
    },
  );
};

// ─── replace_artifact_body helper: flat heading split (admin path) ─────────────
// H1/H2/H3 → /slug blocks (deduped); preamble before first heading → /body;
// no headings → entire body at /body. Conservative: never silently drops content.
function splitBodyIntoBlocks(body: string): { path: string; title: string | null; content: string }[] {
  const lines = body.split("\n");
  let inFence = false;
  const out: { path: string; title: string | null; content: string }[] = [];
  const usedPaths = new Set<string>();
  let curTitle: string | null = null;
  let curLines: string[] = [];

  const flush = () => {
    const content = curLines.join("\n").trim();
    if (!content && curTitle === null) return;
    let base = curTitle ? "/" + slugify(curTitle) : "/body";
    let path = base; let n = 2;
    while (usedPaths.has(path)) path = `${base}-${n++}`;
    usedPaths.add(path);
    out.push({ path, title: curTitle, content });
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) { inFence = !inFence; curLines.push(line); continue; }
    const m = !inFence && line.match(/^(#{1,3})\s+(.+)$/);
    if (m) { flush(); curTitle = m[2].trim(); curLines = []; }
    else curLines.push(line);
  }
  flush();
  if (out.length === 0) out.push({ path: "/body", title: null, content: body.trim() });
  return out;
}
