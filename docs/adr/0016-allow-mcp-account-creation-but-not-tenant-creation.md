# Allow MCP account creation but not tenant creation in the first release

The first MCP management surface will allow authorized Operators to create additional WeChat Official Account resources within their existing tenant, subject to subscription plan account allowance, but it will not create new tenants. Tenants are bootstrapped at first login, keeping MCP focused on post-auth resource management rather than organization lifecycle.
