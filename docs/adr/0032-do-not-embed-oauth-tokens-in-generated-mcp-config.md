# Do not embed OAuth tokens in generated MCP config

Generated Codex and Claude MCP configuration will point at the Streamable HTTP `/mcp` endpoint but will not embed OAuth bearer tokens. MCP clients should complete their own OAuth authorization flow, avoiding token leakage through copied config files or support screenshots.
