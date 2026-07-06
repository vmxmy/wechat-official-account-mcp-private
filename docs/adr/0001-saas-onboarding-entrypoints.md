# Use REST as the onboarding authority with Web, CLI, and MCP entrypoints

We will implement public SaaS onboarding with the hosted REST/OAuth/D1/Stripe backend as the source of truth, a minimal Web entrypoint for first-time signup and Stripe return handling, a CLI entrypoint that can independently complete developer onboarding, and an MCP entrypoint for authorized post-login management. This avoids making MCP responsible for unauthenticated signup while keeping CLI and MCP behavior consistent through shared backend use cases.
