# Use /auth/github/callback for GitHub login

The GitHub OAuth App callback path will be `/auth/github/callback` under the production origin. This keeps human Web login separate from the MCP OAuth provider endpoints such as `/authorize` and `/oauth/token`.
