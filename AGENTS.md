# Repository Guidelines

This repository is a WeChat Official Account MCP service. Keep this file limited to project-specific constraints that are easy to miss; architecture and usage details belong in `README.md` and the source tree.

## Sources of Truth

- Treat WeChat's official documentation as authoritative for API endpoints, fields, signatures, error codes, quotas, draft HTML, and media rules.
- Before changing a WeChat API integration, check `WECHAT_OFFICIAL_API_CONTRACT.md` and reopen the corresponding official documentation. Do not restore historical endpoints or fields without re-verification.
- Avoid unverified coverage claims such as “95%” or “100%”.

## Runtime Boundaries

- Production MCP runs only on Cloudflare Workers through OAuth-protected Streamable HTTP at `/mcp`.
- `@ziikoo/woa` is a remote-only CLI. Do not restore a local MCP server, stdio transport, SSE endpoints, SQLite storage, a Node/Axios executor, or local-file-path media schemas.
- Node is tooling only. Worker runtime code must use `fetch`, Web `FormData`, `Uint8Array`, D1, R2, KV, and Durable Objects.
- MCP media schemas expose `fileUrl` or `r2Key`. Local files must first be uploaded through the protected `woa media upload` flow and staged in R2.
- WeChat API fixed egress uses the HTTPS relay configured by `WECHAT_PROXY_URL`; do not reintroduce HTTP CONNECT proxy support.

## Code Conventions

- The project uses ESM. TypeScript imports must include the emitted `.js` extension, including imports from `.ts` source files.
- Prefer relative imports in backend code; compiled Node output does not resolve the `@/` alias automatically.
- Use kebab-case files, PascalCase types/classes, camelCase functions/variables, UPPER_SNAKE_CASE constants, and snake_case MCP tool names.
- Reuse schemas from `src/utils/validation.ts` where possible. Register new tools in `src/mcp-tool/tools/index.ts` and update validation fixtures or expected tool counts.

## WeChat Article HTML

- Draft `content` must stay below WeChat's documented size limits and contain no JavaScript.
- Article images must use URLs returned by WeChat's article-image upload API; external image URLs may be removed.
- Keep layouts mobile-first and sanitizer-safe: inline styles, `width:auto` or `100%`, no fixed heights, no `<pre>`, no `!important`, no absolute-position hacks, no gradient-backed text highlights, and no custom `font-family` unless an official rule explicitly requires it.
- Do not place block elements inside leaf spans or nest identical tags more than 15 levels.
- For body copy, default to 16px with approximately 1.75 line height; keep supporting text at least 14px and avoid display text that causes narrow-screen overflow.
- Before uploading a draft, run the official structure verifier at `https://mp.weixin.qq.com/article-bin/verify_article_structure` and treat any reported issue as a release blocker.
- Keep a local sync of the official editor HTML constraints under `docs/wechat-official/` (`WECHAT_OFFICIAL_HTML_CONSTRAINTS.md` + source snapshots). Refresh with `python3 docs/wechat-official/_sync_and_audit.py`.

## Security

- Never commit AppSecret, access tokens, webhook secrets, OAuth credentials, relay tokens, exported article data, or local OMX state.
- Store production secrets in Cloudflare secret bindings. Do not put them in `wrangler.jsonc`.
- Preserve log redaction. Never log full credentials or target URLs containing `access_token`.
- Do not enable debug logging in production or configure production CORS as `*`.
- `/wx/callback` must verify signatures, decrypt safely, persist the message, and acknowledge quickly; it must not perform long-running AI work.

## Validation

Use Node 18+ tooling. Before handing off a code change, run the smallest relevant checks and report the exact commands. For cross-cutting or release changes, run:

```bash
npm run check
npm run lint
npm run build:prod
npm test
npx wrangler deploy --dry-run
```

`npm test` builds production output and runs `test-tools.js`; the repository does not currently have a conventional unit-test suite.

## Key References

- `README.md`: setup and user-facing documentation
- `WECHAT_OFFICIAL_API_CONTRACT.md`: verified WeChat API contract notes
- `docs/wechat-official/WECHAT_OFFICIAL_HTML_CONSTRAINTS.md`: synced WeChat editor HTML structure/CSS constraints + official verify workflow
- `src/worker/index.ts`: Worker routes, OAuth, MCP, webhook wiring
- `src/mcp-tool/tools/`: MCP tool definitions
- `src/wechat/api-client.ts`: WeChat API wrapper
- `src/utils/validation.ts`: schemas and HTML sanitization
- `test-tools.js`: build-output regression checks
