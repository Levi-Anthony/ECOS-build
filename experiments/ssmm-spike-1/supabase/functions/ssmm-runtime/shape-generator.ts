import { type InstalledLoop, parseInstalledLoop } from "./contracts.ts";
import {
  enforceRuntimeHandles,
  SHAPE_SYSTEM_PROMPT,
  shapePrompt,
} from "./prompts.ts";
import type { SessionState } from "./state-machine.ts";

export type ShapeConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export async function generateShape(
  config: ShapeConfig,
  state: SessionState,
  strongestClaim: string,
  correction?: string,
): Promise<InstalledLoop> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SHAPE_SYSTEM_PROMPT },
        {
          role: "user",
          content: shapePrompt(state, strongestClaim, correction),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`shape_provider_${response.status}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("shape_provider_invalid_response");
  }
  const parsed = parseInstalledLoop(JSON.parse(content));
  return enforceRuntimeHandles(parsed, state.purpose_handle);
}
