# Treat REST as an internal stable API for entrypoints

The `/api/v1` REST surface will be the stable backend contract shared by Web, CLI, and MCP-adjacent management flows, but it will not be marketed as a standalone public developer API in the first release. This limits external compatibility obligations while keeping entrypoints consistent.
