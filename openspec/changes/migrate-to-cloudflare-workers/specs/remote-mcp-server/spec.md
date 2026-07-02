## ADDED Requirements

### Requirement: Streamable HTTP MCP endpoint
The system SHALL expose all 16 registered MCP tools over the standard MCP Streamable HTTP transport at a single `/mcp` endpoint on Cloudflare Workers, using the Agents SDK `McpAgent.serve()` handler. The exposed protocol SHALL be standards-compliant MCP JSON-RPC (initialize / tools/list / tools/call) so that any conformant MCP client can connect without Cloudflare-specific SDKs.

#### Scenario: Conformant client discovers all tools
- **WHEN** a standards-compliant MCP client sends `initialize` then `tools/list` to `https://<worker>/mcp`
- **THEN** the server returns all 16 tools with their names, descriptions, and Zod-derived input schemas, and assigns an `Mcp-Session-Id` for the session

#### Scenario: Tool call round-trips as JSON-RPC
- **WHEN** the client sends `tools/call` with `name=wechat_draft` and valid `arguments`
- **THEN** the server executes the handler and returns a `WechatToolResult` content array, without any Cloudflare-private protocol wrapper

### Requirement: SSE and local stdio transports are removed
The system SHALL NOT expose the deprecated MCP-over-SSE (`/sse` + `/messages`) transport or local stdio/CLI MCP runtime. All clients use the Workers Streamable HTTP `/mcp` endpoint directly or via an external `mcp-remote` bridge.

#### Scenario: Legacy SSE endpoint absent
- **WHEN** a legacy client requests `/sse`
- **THEN** the server returns 404 or an explicit removal message, never an SSE stream

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

#### Scenario: Local stdio build artifact absent
- **WHEN** the production build completes
- **THEN** no `dist/src/cli.js` or `dist/src/mcp-server` artifact exists
