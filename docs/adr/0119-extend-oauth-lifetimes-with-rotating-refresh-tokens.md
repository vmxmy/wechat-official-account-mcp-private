# Extend OAuth lifetimes with rotating refresh tokens

ADR 0065 is superseded for hosted CLI and MCP OAuth grants. Access tokens last 8 hours, rotating and revocable refresh tokens last 180 days, and dynamic public client registrations last 365 days. Clients refresh before expiry and persist a replacement refresh token atomically when the provider rotates it.

This reduces repeated browser authorization for long-running and headless servers without creating a permanent credential. Revocation, refresh-token expiry, scope changes, or Operator/session removal still force a new authorization. MCP configuration contains only the remote `/mcp` URL and OAuth discovery facts; it never embeds an access token, refresh token, or static Bearer header.
