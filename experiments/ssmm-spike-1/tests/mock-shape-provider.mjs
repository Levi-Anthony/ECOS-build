import { createServer } from "node:http";

const host = process.env.SSMM_MOCK_SHAPE_HOST ?? "127.0.0.1";
const port = Number(process.env.SSMM_MOCK_SHAPE_PORT ?? "55430");

const shape = {
  move_target: "Write and save one bounded field-note paragraph",
  decision: "Produce the bounded field-note paragraph now",
  orientation: "Prefer field evidence over abstraction",
  immediate_why: "The live test requires a durable result",
  reason_chain_handles: ["project:ssmm-spike-1"],
  exit_condition: "The saved field-note paragraph exists in the open document",
  degrees_of_freedom: ["wording", "sentence count"],
  quick_check_adjustments: ["reduce to three sentences if energy drops"],
  help_required_conditions: ["the target document becomes unavailable"],
  invalidation_conditions: ["the field-note obligation is withdrawn"],
  anticipated_obstacles: ["interruption", "over-expansion"],
  completion_evidence: ["the saved field-note paragraph"],
  installation_requirements: ["the field-note document is open and editable"],
  first_physical_action: "Place the cursor in the field-note document",
  interruption_handling: "Return through the Move cockpit and resume at the cursor",
  cockpit_cues: ["show target", "show exit condition", "show current position"],
  uncertainty: "The available uninterrupted interval may shorten",
  purpose_handle: { id: "provider-invented-purpose", label: "Provider value must not win" },
};

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    try {
      JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(shape) } }],
      }));
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_json" }));
    }
  });
});

server.listen(port, host, () => {
  console.log(`mock Shape provider listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
