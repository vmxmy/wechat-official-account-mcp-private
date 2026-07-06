# Use Turnstile and rate limits for public signup

Public Web signup and email fallback flows will use Cloudflare Turnstile plus rate limits keyed by IP, email, and provider subject where applicable. CLI and MCP clients continue to authenticate through OAuth, inheriting the same backend identity and abuse controls.
