# WOA Web Astryx/TanStack component choices

Date: 2026-07-06
Change: `openspec/changes/saas-onboarding`
Scope: Web entrypoint foundations under `web/`.

## Dense docs bootstrap evidence

- Ran `npx astryx --dense docs` and saved output to `docs/design/astryx/bootstrap-dense.txt`.
- Ran `npx astryx --dense docs getting-started`, `theme`, and `layout`; saved the dense outputs beside this note.
- Ran `npx astryx --dense component` for the components used below and saved the dense outputs as `component-*-dense.txt`.
- Ran `npx astryx --dense search "ThemeProvider LinkProvider Button Input Field Card"` to confirm relevant components/templates before implementation.

## Chosen primitives

- Theme: local `ziikooTheme` via `defineTheme()` from `@astryxdesign/core/theme`, wrapped by a project `ThemeProvider` facade in `web/src/providers.tsx` using Astryx `Theme`.
- Link integration: Astryx `LinkProvider` with a central `AppLink` adapter backed by TanStack Router `Link` for internal paths and native `<a>` for external/mail/hash links.
- Routing: TanStack file routes under `web/src/routes`, generated route tree at `web/src/routeTree.gen.ts`, and `returnTo` redirect guard helper in `web/src/route-guards.ts`.
- Server state: `QueryClientProvider` with short stale time and no retry; billing checkout mutation invalidates `['billing']` before navigating to Stripe.
- Forms: native `<form>` elements plus Astryx `TextInput` and Zod validation helpers for login/search/API boundaries.
- Layout/data display: Astryx `Section`, `Button`, `Link`, `StatusDot`, `CodeBlock`; custom CSS is limited to app shell, definition lists, tables, and restrained spacing.

## Anti-slop decisions

- No KPI cards, hero eyebrow pills, gradient text/buttons, blobs, glassmorphism, decorative icon tiles, or three-column feature grids.
- Quota/plan/resource facts are shown as definition lists, inline status rows, code blocks, and simple tables.
- Copy is Chinese-first and operational: AppID/AppSecret, relay 白名单, Codex MCP 配置, Stripe Checkout, support@ziikoo.app.
- MCP config examples never include OAuth tokens or WeChat secrets.
