# SaaS Onboarding Chinese Copy Anti-Slop Review

- Review timestamp: 2026-07-17T00:47:00Z
- Scope: Web routes, CLI help, README onboarding sections, and onboarding/billing/MCP copy visible in the current branch.

## Checks run

```bash
rg -n -i 'gradient|glass|blob|glow|hero eyebrow|KPI|stat card|feature grid|赋能|一站式|极致|supercharge|empower|world-class|enterprise-grade' web/src
rg -n -i '赋能|一站式|极致|超级|企业级|世界级|智能化|降本增效|闭环' README.md src/cli web/src
```

## Findings

- No forbidden Web visual/copy trope hits were found in `web/src` during the grep pass.
- Product copy is concrete and operational where implemented: AppID/AppSecret configuration, relay allowlist guidance, remote `/mcp` configuration, billing checkout, quota/status, and deletion confirmations.
- `/mcp` 页面现在以 Kimi Code 为默认向导，并分别提供 Kimi/Claude/Codex 的原生 OAuth 添加、登录和验证步骤；可复制内容不包含静态 Bearer、Authorization header 或 token 环境变量。
- 页面明确说明 OAuth 自动刷新不等于永久授权；静态 Bearer 只作为风险解释出现，不提供示例值、header 模板或降级接入路径。
- The current Web onboarding/login/security pages still include some static form scaffolding; this review does not mark data-driven onboarding or live session revocation complete.

## Acceptance

- Passed for current implemented Web/CLI/README copy.
- MCP desktop/mobile screenshot review is recorded in `docs/screenshots/saas-onboarding/visual-review.json`; production OAuth smoke remains a separate release gate.
