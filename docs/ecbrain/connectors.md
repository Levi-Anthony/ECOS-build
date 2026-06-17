# ECBRAIN V1 — Connectors

How to connect a client to the ECBRAIN production MCP, how to verify
the connection safely, and how to recover from common failure modes.

---

## One endpoint, multiple connectors

There is exactly one production MCP function:

```
https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp
```

Multiple client connectors can point at this single endpoint. Each
client (Claude Code, Claude.ai web, future clients) has its own
connector record. They share the endpoint and the access key; they
do not share the connector record.

The expected tool count across all connected clients is **48**.
A divergence means one client has stale state, not that production
has changed.

## Claude Code (local) — `ecb`

The Claude Code local connector is named `ecb` and uses the
`x-brain-key` header for auth.

**Auth:** `x-brain-key: <MCP_ACCESS_KEY>` request header.
**URL:** `https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp`
(no query-string key).
**Reason header is preferred:** the URL is not secret-bearing on its
own. Logs and error traces that surface the URL do not surface the
key. Rotation is a header-value change, not a URL change.

To verify the connector is alive without exposing tool internals,
ask the assistant in a fresh Claude Code session:

> Confirm the ecb connector is connected and report the tool count
> only. Do not call any tool. Do not show me the URL.

Expected reply: connected, tool count `48`. If the count differs,
the connector either has stale state or is pointing at a different
endpoint.

## Claude.ai (web)

The Claude.ai web connector is also connected. At the time of
cutover, the Claude.ai connector UI did not support custom request
headers, which forced the use of the `?key=` query-string fallback.
This is the only reason the web connector uses query-string auth.

**Auth (current):** `?key=<MCP_ACCESS_KEY>` in the URL — secret-bearing.
**Auth (preferred when supported):** `x-brain-key` header — same as Claude Code.

**Implication:** the URL itself is sensitive. Do not paste the
connector URL into chat, screenshots, issue comments, or shared
documents. Treat it the way you would treat a token.

If a future Claude.ai release supports custom headers for MCP, the
web connector should be migrated off the query-string and rotated.
The migration is: configure the new header connector, verify tool
count, retire the old query-string connector, rotate the key.

## Verifying tool count safely

Verification should not reveal the access path. Use this prompt
shape in a fresh client session:

> Confirm connection to the ECBRAIN MCP. Report only:
> 1. connected: yes/no
> 2. tool count: <number>
> Do not list tools. Do not echo URLs. Do not echo headers.

Expected: `connected: yes`, `tool count: 48`. Anything else is a
signal — investigate in a non-mutating way before assuming a
production problem.

## Recovering from 401 (Unauthorized)

A 401 from the MCP endpoint means auth failed. Possible causes,
roughly in order of likelihood:

1. **Connector has stale or wrong key** — the client is sending an
   old key value or none at all. Reconfigure the connector with the
   current key. Do not paste the key into chat.
2. **URL/header mismatch** — the client is hitting the right URL but
   sending the key in the wrong place (header vs query-string).
   Confirm the connector is configured to send via the supported
   path for this client.
3. **Key was rotated** — `MCP_ACCESS_KEY` was rotated and the
   connector was not updated. Update the connector with the new key
   value via the platform's secret store, never via chat.
4. **Endpoint path is wrong** — the URL includes a typo or wrong
   function name. Compare against `current-state.md`.
5. **Network or function deploy issue** — the function is not
   reachable for reasons unrelated to auth, and 401 is a misleading
   surface. Check function logs (read-only) before reconfiguring.

A 401 is not a reason to disable auth. It is a reason to fix the
connector.

## Secret rotation vs connector configuration

These are two different actions, often conflated:

| Action                  | What it changes                            | When                                     |
|-------------------------|--------------------------------------------|------------------------------------------|
| Secret rotation         | The actual `MCP_ACCESS_KEY` value          | Suspected exposure; periodic; offboarding |
| Connector configuration | How a client sends the existing key        | New client; existing client misconfigured |

Rotation is a server-side action followed by an update of every
client connector. If you rotate without updating connectors, all
clients break. If you update a connector with a key that has not
been rotated, you have only changed the client; the server still
accepts the old key from anyone else who has it.

## When to rotate `MCP_ACCESS_KEY`

Rotate when any of the following is true:

- The current key has been pasted into chat, a public document, a
  screenshot, an issue comment, or any other place outside the
  intended secret store.
- A `?key=...` URL containing the current key has been shared,
  logged, or otherwise persisted in a non-secret context.
- A trusted client device is lost, retired, or transferred.
- Periodic rotation policy fires (no policy is set yet; this should
  be decided as a separate work order).

Rotation flow (high level — see `operations-runbook.md` for guard rails):

1. Generate the new key value via the platform secret store.
2. Update the function secret.
3. Update every client connector to use the new value.
4. Verify each client reports `connected: yes` with tool count `48`.
5. Old key value is now invalid; treat as expired but still
   sensitive (do not log or share even after rotation).

## Warnings

- **Do not paste the access key into chat.** Not the current value,
  not a previous value, not a "test value." Once it is in chat, it
  is in the conversation history.
- **Query-string MCP URLs are secret-bearing.** A URL containing
  `?key=...` is sensitive. Do not log it, do not paste it into
  documents, do not screenshot it.
- **Do not share connector URLs in support requests.** Describe the
  symptom and the client; the URL adds nothing diagnostically and
  may expose secrets.
- **Tool count divergence is a client-side signal.** Production
  tool count is `48`. A client showing a different number has stale
  state — investigate the client, not production.
