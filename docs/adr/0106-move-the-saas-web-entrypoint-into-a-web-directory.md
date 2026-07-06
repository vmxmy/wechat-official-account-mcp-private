# Move the SaaS Web entrypoint into a web directory

The SaaS Web entrypoint will be organized under a dedicated `web/` directory rather than continuing to share the root `src/` tree with Worker, MCP, and WeChat runtime code. This strengthens frontend/backend boundaries at the cost of updating Vite, TypeScript, and deployment build paths.
