## ADDED Requirements

### Requirement: Streamable HTTP MCP endpoint
The system SHALL expose all 15 registered MCP tools over the standard MCP Streamable HTTP transport at a single `/mcp` endpoint on Cloudflare Workers, using the Agents SDK `McpAgent.serve()` handler. The exposed protocol SHALL be standards-compliant MCP JSON-RPC (initialize / tools/list / tools/call) so that any conformant MCP client can connect without Cloudflare-specific SDKs.

#### Scenario: Conformant client discovers all tools
- **WHEN** a standards-compliant MCP client sends `initialize` then `tools/list` to `https://<worker>/mcp`
- **THEN** the server returns all 15 tools with their names, descriptions, and Zod-derived input schemas, and assigns an `Mcp-Session-Id` for the session

#### Scenario: Tool call round-trips as JSON-RPC
- **WHEN** the client sends `tools/call` with `name=wechat_draft` and valid `arguments`
- **THEN** the server executes the handler and returns a `WechatToolResult` content array, without any Cloudflare-private protocol wrapper

### Requirement: SSE transport is not ported
The system SHALL NOT expose the deprecated MCP-over-SSE (`/sse` + `/messages`) transport on Workers. Existing Node SSE support is superseded and will not be migrated.

#### Scenario: Legacy SSE endpoint absent
- **WHEN** a legacy client requests `/sse` on the Worker
- **THEN** the server returns 404 (or an explicit deprecation message), never an SSE stream

### Requirement: Hibernation and state recovery
The `McpAgent` instance SHALL rely on Durable Object hibernation so the server consumes compute only while actively processing, and session state SHALL survive hibernation via DO storage.

#### Scenario: Idle session hibernates then resumes
- **WHEN** a session is idle long enough to trigger hibernation and the same session reconnects
- **THEN** the server resumes from persisted DO state without loss of in-session tool context

### Requirement: Stream resumability for long tool calls
The system SHALL support MCP stream resumability via `Last-Event-ID` so that in-flight streaming tool calls (e.g. `wechat_mass_send` status polling) survive the Cloudflare ~5-minute edge idle-stream watchdog.

#### Scenario: Connection drops mid-stream
- **WHEN** a streaming tool response is interrupted and the client reconnects with `Last-Event-ID`
- **THEN** the server replays any missed events up to and including the final response, using a configured `EventStore`
