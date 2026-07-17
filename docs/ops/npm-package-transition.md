# npm Package Transition Tracker

## Current package

- Public package: `@ziikoo/woa`
- Executable: `woa`
- Publish workflow: `.github/workflows/npm-publish.yml`
- Required CI secret: `NPM_TOKEN` only. The workflow also grants GitHub OIDC `id-token: write` for npm provenance. Cloudflare, Stripe, WeChat, Resend, Turnstile, GitHub OAuth, and encryption/runtime business secrets must remain in Cloudflare or provider consoles, not npm publish CI.

## Publish procedure

1. Ensure `main` is clean and verified:
   ```bash
   openspec validate saas-onboarding
   npm run check
   npm run lint
   npm test
   npm pack --dry-run
   ```
2. Confirm `package.json` has `name: "@ziikoo/woa"` and `bin.woa: "dist/src/cli/woa.js"`.
3. Configure GitHub repository secret `NPM_TOKEN` with publish permission for the `ziikoo` npm scope.
4. Confirm the GitHub source repository is public. npm does not issue provenance attestations for packages built from a private repository; release stops here while the repository remains private.
5. Trigger **Publish npm CLI** manually from `main` with dist-tag `next`. The workflow publishes with provenance and verifies the exact package version, extracted contents, tarball integrity and `next` resolution.
6. Exercise that exact prerelease. Do not change `package.json` or rebuild a different version between verification and promotion.
7. Trigger the same workflow again from the same commit with dist-tag `latest`, or push the matching `woa-v<version>` tag. The workflow refuses to publish a new version directly to `latest`; it only moves `latest` when `next` already resolves to the same exact version and contents.
8. Verify after promotion:
   ```bash
   npm view @ziikoo/woa dist-tags versions --json
   npx -y --registry=https://registry.npmjs.org --package @ziikoo/woa@latest woa --version
   npx -y --registry=https://registry.npmjs.org --package @ziikoo/woa@latest woa help agent
   ```

The public Agent bootstrap page may deploy only after step 8 succeeds. Moving `latest` to a version that was not the verified `next` artifact is a release failure.

## Old package removal external task

The historical package name is not republished by this workflow. Removal or deprecation must be completed in npm by an account that owns the old package:

- [ ] Confirm the exact old package name and npm owner.
- [ ] Run `npm deprecate <old-package>@"*" "Use @ziikoo/woa instead."` if ownership is available.
- [ ] If policy allows unpublish, follow npm support/policy steps; otherwise keep deprecation notice.
- [ ] Update any public docs that still mention the old package.

This tracker intentionally avoids storing npm tokens or old-package owner credentials in the repository.
