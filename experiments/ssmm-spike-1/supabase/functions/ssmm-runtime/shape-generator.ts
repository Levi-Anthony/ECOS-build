import { parseShapeContent, type ShapeContent } from "./contracts.ts";
import {
  enforceRuntimeHandles,
  SHAPE_SYSTEM_PROMPT,
  shapePrompt,
} from "./prompts.ts";
import type { MainLoopState } from "./state-machine.ts";

export type ShapeConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export async function generateShape(
  config: ShapeConfig,
  state: MainLoopState,
  correction?: string,
): Promise<ShapeContent> {
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
        { role: "user", content: shapePrompt(state, correction) },
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
  const parsed = parseShapeContent(JSON.parse(content));
  return enforceRuntimeHandles(parsed, state.purpose_handle);
}
