# Use TanStack Router for the Web entrypoint

The SaaS Web entrypoint will use TanStack Router instead of React Router. Astryx `LinkProvider` must be wired to the TanStack Router link component so Astryx navigation components preserve SPA routing semantics without hard navigations.
