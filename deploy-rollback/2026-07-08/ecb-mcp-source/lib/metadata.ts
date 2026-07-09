// Metadata extraction — LLM-based self-containment rewrite + metadata fields.
// Model: openai/gpt-4o-mini via OpenRouter. Returns fallback on any LLM failure.
// OPENROUTER_API_KEY is validated at startup by helpers.ts before any tool call runs.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const SYSTEM_PROMPT = `You are processing a captured thought for storage in a semantic memory system. Complete two tasks and return a single JSON object.

TASK 1 — Self-containment rewrite:
Rewrite the content to stand alone when retrieved cold with no conversation context. Remove or replace session-specific references ("in this session," "as discussed," "earlier," "the above," etc.) by substituting the actual referent. If no session references exist, return the content unchanged. Preserve all meaning. Do not summarize.

TASK 2 — Metadata extraction from the rewritten content:
- "rewritten_content": the self-contained version from Task 1 (required)
- "needs_split": true if this entry requires two distinct concept-labels to fully describe its content — i.e., it sits at the intersection of two semantic neighborhoods rather than at the center of one. Close relationship between the concepts is NOT a reason to omit this flag; closely-related but distinct mechanisms or claims are still two separate centers of mass. false only if one concept-label covers the entire entry.
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates as YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
- "domain": one of "ecos-architecture", "tango-pedagogy", "ttc-board", "neil-outreach", "it-consulting", "music-production", "brain-protocol", "personal" — choose the single best-fit domain
- "horizon": one of "immediate" (time-sensitive, actionable now), "project" (relevant to an active project, not urgent), "evergreen" (durable reference or principle)
- "signal_type": one of "taste" (aesthetic preference or style constraint), "voice" (tone, phrasing, communication style), "struct" (structural pattern or architecture), "decision" (committed choice or resolution), "framework" (conceptual model or heuristic), "content" (factual or narrative content)
- "confidence": one of "observed" (directly witnessed or stated), "inferred" (reasoned from evidence), "hypothetical" (speculative or conditional)

Return only the JSON object.`;

const FALLBACK: Record<string, unknown> = {
  topics: ["uncategorized"],
  type: "observation",
  _fallback: true,
};

export async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY")!;
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    if (!r.ok) return { ...FALLBACK };
    const d = await r.json();
    try {
      return JSON.parse(d.choices[0].message.content);
    } catch {
      return { ...FALLBACK };
    }
  } catch {
    return { ...FALLBACK };
  }
}
