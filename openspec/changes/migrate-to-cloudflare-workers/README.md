# migrate-to-cloudflare-workers

Migrate and cut over the MCP runtime to Cloudflare Workers Streamable HTTP `/mcp` via Agents SDK McpAgent + Durable Object. The final runtime is HTTP-only: local desktop stdio/CLI, MCP-over-SSE, native sqlite3, axios/Node form-data, and local filePath media upload code are removed.
