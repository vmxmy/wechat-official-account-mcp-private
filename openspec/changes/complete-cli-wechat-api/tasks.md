## 1. MCP CLI Core

- [x] 1.1 Add a reusable authenticated Streamable HTTP MCP client module with tools/list, tools/call, close, refresh, and 401 retry behavior
- [x] 1.2 Add structured JSON input loading from inline input, file, and stdin with mutual-exclusion and object validation
- [x] 1.3 Add centralized WeChat tool filtering, account injection, sensitive-field redaction, dry-run, and exact high-impact confirmation policy

## 2. Command Surface

- [x] 2.1 Implement `woa api list/describe/call` and equivalent `woa mcp tools/describe/call` command dispatch and JSON output
- [x] 2.2 Implement explicit `wechat-full` OAuth scope profile and missing-scope recovery guidance
- [x] 2.3 Implement `woa draft add/update/get/count` through the shared MCP call path while preserving existing list/delete behavior
- [x] 2.4 Update CLI help and Agent-facing safety guidance for the complete API surface

## 3. Verification

- [x] 3.1 Add unit and contract tests for JSON input, account selection, high-impact confirmation, redaction, and tool result exit behavior
- [x] 3.2 Add an authenticated local MCP integration test proving tools/list and representative read/write calls through Streamable HTTP
- [x] 3.3 Add a registry/tool parity assertion proving every current `wechat_*` MCP tool is discoverable through the CLI gateway

## 4. Documentation and Release Gates

- [x] 4.1 Update README and capability documentation with safe examples, scope profile, draft commands, file/stdin input, and remote-only boundaries
- [x] 4.2 Run OpenSpec strict validation, typecheck, lint, full tests, Worker dry-run, and npm pack verification
