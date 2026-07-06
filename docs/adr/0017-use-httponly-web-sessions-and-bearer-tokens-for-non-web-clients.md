# Use HttpOnly Web sessions and bearer tokens for non-Web clients

The Web entrypoint will keep authenticated state in an HttpOnly session cookie, while CLI and MCP clients continue to use OAuth bearer tokens. This avoids exposing tokens to browser JavaScript while preserving standard token-based access for non-browser clients.
