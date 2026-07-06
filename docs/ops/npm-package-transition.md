# npm Package Transition Tracker

## Current package

- Public package: `@ziikoo/woa`
- Executable: `woa`
- Publish workflow: `.github/workflows/npm-publish.yml`
- Required CI secret: `NPM_TOKEN` only. Cloudflare, Stripe, WeChat, Resend, Turnstile, GitHub OAuth, and encryption/runtime business secrets must remain in Cloudflare or provider consoles, not npm publish CI.

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
4. Trigger **Publish npm CLI** manually with dist-tag `latest` or push a `woa-v*` tag.
5. Verify after publish:
   ```bash
   npm view @ziikoo/woa version
   npx @ziikoo/woa --help
   ```

## Old package removal external task

The historical package name is not republished by this workflow. Removal or deprecation must be completed in npm by an account that owns the old package:

- [ ] Confirm the exact old package name and npm owner.
- [ ] Run `npm deprecate <old-package>@"*" "Use @ziikoo/woa instead."` if ownership is available.
- [ ] If policy allows unpublish, follow npm support/policy steps; otherwise keep deprecation notice.
- [ ] Update any public docs that still mention the old package.

This tracker intentionally avoids storing npm tokens or old-package owner credentials in the repository.
