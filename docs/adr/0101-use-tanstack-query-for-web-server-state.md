# Use TanStack Query for Web server state

The SaaS Web entrypoint will use TanStack Query for server state, API mutations, cache invalidation, and retry/error handling around `/me`, onboarding, tenant/account, billing, MCP config, and security session data. This avoids duplicating ad hoc fetch hooks across pages.
