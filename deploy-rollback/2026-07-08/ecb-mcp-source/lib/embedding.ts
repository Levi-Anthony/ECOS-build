// Embedding — OpenRouter wrapper for openai/text-embedding-3-small (1536 dims).
// OPENROUTER_API_KEY is validated at startup by helpers.ts before any tool call runs.
// Errata §2: embedding-bearing writes compute this synchronously before DB insert.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")!;
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}
