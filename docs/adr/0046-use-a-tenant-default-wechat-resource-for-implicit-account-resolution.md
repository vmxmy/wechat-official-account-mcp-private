# Use a tenant default WeChat resource for implicit account resolution

When a tenant has multiple WeChat Official Account resources, calls that omit an account ID will target the tenant's default resource. The default can be changed through Web, CLI, or MCP and must be audited, keeping common operations concise without making account selection ambiguous.
