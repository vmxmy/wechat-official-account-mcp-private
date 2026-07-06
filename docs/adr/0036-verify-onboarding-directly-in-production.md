# Verify onboarding directly in production

The onboarding implementation will be verified directly against production rather than requiring a separate preview/test environment gate. Destructive delete operations still require explicit confirmation, while credential configuration, OAuth, Stripe, and publish-related production smoke checks follow the confirmed product guardrails.
