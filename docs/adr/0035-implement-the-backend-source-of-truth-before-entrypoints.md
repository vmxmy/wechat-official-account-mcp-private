# Implement the backend source of truth before entrypoints

Implementation will proceed backend-first: D1 identity/billing/onboarding repositories, OAuth/session behavior, REST use cases, and Stripe webhooks will be made authoritative before Web, CLI, and MCP entrypoints are wired to them. This reduces rework and ensures all entrypoints share the same onboarding and authorization semantics.
