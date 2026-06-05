import "server-only";

type McpCallResult = {
  text: string;
  isError: boolean;
};

const parseResponse = (body: string, contentType: string | null): unknown => {
  if (contentType?.includes("text/event-stream")) {
    let parsed: unknown = null;
    for (const line of body.split("\n")) {
      if (line.startsWith("data:")) parsed = JSON.parse(line.slice(5).trim());
    }
    return parsed;
  }
  return body.trim() ? JSON.parse(body) : null;
};

const endpoint = (): string | null => {
  if (process.env.ECB_URL) return process.env.ECB_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return supabaseUrl ? `${supabaseUrl}/functions/v1/ecb-mcp` : null;
};

export async function invokeEcbTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const url = endpoint();
  const key = process.env.ECB_KEY ?? process.env.MCP_ACCESS_KEY;
  if (!url || !key) {
    return { text: "ECB_URL/ECB_KEY not configured; embedding regeneration remains pending.", isError: true };
  }

  const request = async (payload: Record<string, unknown>, sessionId?: string) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-brain-key": key,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`ECB MCP HTTP ${response.status}: ${body.slice(0, 300)}`);
    return {
      data: parseResponse(body, response.headers.get("content-type")) as Record<string, unknown> | null,
      sessionId: response.headers.get("mcp-session-id") ?? sessionId,
    };
  };

  const initialized = await request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ecos-dashboard", version: "1" },
    },
  });
  await request({ jsonrpc: "2.0", method: "notifications/initialized" }, initialized.sessionId);
  const called = await request({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  }, initialized.sessionId);

  const result = called.data?.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  return {
    text: result?.content?.map((item) => item.text ?? "").join("") ?? "",
    isError: result?.isError === true,
  };
}

export async function reindexArtifactPaths(key: string, paths: string[]): Promise<string[]> {
  const warnings: string[] = [];
  const blockPaths = Array.from(new Set(paths.filter((path) => path.startsWith("/") && !path.startsWith("/@"))));
  for (const path of blockPaths) {
    try {
      const result = await invokeEcbTool("reindex_artifact_embeddings", {
        key,
        path,
        only_missing: false,
        limit: 1,
      });
      if (result.isError) warnings.push(result.text);
    } catch (error) {
      warnings.push((error as Error).message);
    }
  }
  return warnings;
}
