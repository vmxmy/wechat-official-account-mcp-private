# Allow dynamic public OAuth clients with PKCE

CLI and MCP clients may dynamically register public OAuth clients, but they must use PKCE and pass redirect URI validation. The Web entrypoint will use a fixed confidential client, keeping browser session handling separate from public client onboarding convenience.
