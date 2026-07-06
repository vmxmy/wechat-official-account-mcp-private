# WOA SaaS Web Anti-AI-Slop Rules

These rules are mandatory for the SaaS Web entrypoint. The Web UI uses Astryx semantic tokens and components as the source of truth. Do not introduce page-local visual systems, raw Tailwind UI, or one-off design kits.

## Forbidden visual patterns

- Do not use KPI/stat cards as the default carrier for comparable numbers, limits, quota usage, or account status. Use inline stats, definition lists, table rows, or borderless flex rows.
- Do not wrap metrics in decorative backgrounds, borders/rings, shadows, icon circles, colored side borders, gradients, or glows.
- Do not build symmetric three-column feature grids with icon + heading + short description for console/onboarding surfaces.
- Do not use ornamental icon tiles: rounded square/circle icon containers stacked above headings. Icons may be inline with labels only when they clarify action or state.
- Do not nest card-like panels for visual depth. Flatten with spacing, section borders, forms, lists, tables, and definition lists.
- Do not use hero eyebrow pills, decorative numbers, gradient text, gradient buttons, floating blobs, decorative waves, repeated gradient stripes, or emoji as UI elements.
- Do not use purple/violet/indigo AI-gradient palettes, dark-mode colored glow shadows, glassmorphism, or warm cream/beige backgrounds as a reflexive “premium SaaS” look.
- Do not globally center body text. Onboarding forms, settings, tables, panels, and descriptions are left-aligned unless there is a specific empty-state reason.
- Do not overuse modals for credential configuration, billing, sessions, or account settings. If content needs persistent context, scrolling, or multi-step decisions, use a page or section.

## Typography and copy

- Use Astryx font roles and semantic tokens. Numeric quota, billing, token, and usage values use tabular numerals or mono styling where appropriate.
- Keep body copy readable and hierarchy meaningful. Do not use display-size hero typography inside app console pages.
- Avoid generic SaaS filler: “streamline”, “empower”, “supercharge”, “world-class”, “enterprise-grade”, and Chinese equivalents such as “赋能”, “一站式”, “极致”, unless backed by a concrete product fact.
- Prefer specific operational copy: “配置 AppID/AppSecret”, “验证微信白名单”, “复制 Codex MCP 配置”, “本周期剩余发布次数”.
- Avoid repeated rhetorical punchlines or AI-written aphorisms.

## Motion

- Use restrained 150–300ms motion only for state clarification and respect `prefers-reduced-motion`.
- Do not use bounce/elastic easing, hover scale/rotate for images, or animated glow.
- Animate `transform` and `opacity`; do not animate `width`, `height`, `padding`, or `margin` for routine UI transitions.

## Layout and data display

- Design from the user question, not from components. Each page answers one core question: login, complete onboarding, manage billing, configure MCP, or revoke sessions.
- Use forms for credential setup, definition lists for resource facts, tables/lists for sessions and accounts, and inline quota rows for usage.
- Avoid equal-size chart/KPI grids in onboarding. If usage visualization appears, make the primary quota state visually dominant and secondary facts inline.
- Numeric columns are right-aligned with tabular numerals. Status rows use dot + text, not full-cell color blocks.

## Astryx constraints

- Use `@astryxdesign/core` components/templates before writing custom JSX.
- Run Astryx dense docs before component work on a branch.
- Wrap the app in `ThemeProvider` and `LinkProvider`.
- Import Astryx CSS in the required layer order: reset, astryx, theme.
- Do not hand-roll component props from memory; inspect the Astryx component dense card first.
- Swizzle before building a custom replacement when an Astryx component is close but insufficient.
