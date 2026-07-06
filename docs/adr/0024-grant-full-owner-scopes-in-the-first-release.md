# Grant full owner scopes in the first release

The first release will grant Tenant owners the full owner scope set by default while retaining server-side fine-grained scope checks in MCP, CLI-backed REST, and Web API paths. This keeps the single-owner product simple now without removing the enforcement points needed for future team roles and restricted clients.
