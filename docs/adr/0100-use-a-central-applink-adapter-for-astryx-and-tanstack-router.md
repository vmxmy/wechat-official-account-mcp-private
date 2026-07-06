# Use a central AppLink adapter for Astryx and TanStack Router

Although Astryx `LinkProvider` can pass both `href` and `to` to `to`-based routers, the WOA Web entrypoint will provide a single `AppLink` adapter around TanStack Router `Link` and pass that adapter to `LinkProvider`. This centralizes TypeScript compatibility and prevents scattered per-component routing adapters.
