# Use one-hour access tokens and thirty-day refresh tokens

CLI and MCP OAuth clients will receive short-lived access tokens valid for 1 hour and refresh tokens valid for 30 days. Refresh tokens must be revocable and rotated or invalidated according to the server-side session model.
