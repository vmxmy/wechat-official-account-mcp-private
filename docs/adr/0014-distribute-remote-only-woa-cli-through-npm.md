# Distribute the remote-only woa CLI through npm

The CLI will be distributed as an npm package exposing the `woa` command, supporting both `npx` usage and global installation. The CLI remains remote-only: it calls the hosted API and generates remote MCP configuration, but it does not start a local MCP server or store WeChat AppSecrets locally.
