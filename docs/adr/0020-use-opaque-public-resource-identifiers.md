# Use opaque public resource identifiers

Tenant and WeChat Official Account resource IDs exposed through API, CLI, MCP, and webhook URLs will be opaque random identifiers such as `ten_...` and `acct_...`. Human-readable names can be stored separately, but public IDs must not be database sequences or mutable slugs.
