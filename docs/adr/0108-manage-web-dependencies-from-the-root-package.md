# Manage Web dependencies from the root package

Even after moving the Web entrypoint into `web/`, dependencies and scripts will remain managed by the root `package.json` rather than introducing a workspace or separate `web/package.json`. This keeps the build and CI model simple for the first SaaS release.
