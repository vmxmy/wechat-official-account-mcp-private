# Use CLI login as first registration

The CLI will not implement a separate registration protocol: `woa login` opens the hosted OAuth flow, and the first successful login automatically registers the Operator and bootstraps the default tenant and unconfigured WeChat resource. This keeps CLI onboarding aligned with Web while avoiding duplicate signup semantics.
