# Verify Stripe with live mode in production

Stripe subscription verification for the onboarding release will use live mode in production rather than a test-mode dry run on the production origin. This proves the real billing loop but requires treating checkout, cancellation, and refunds as real payment operations during smoke testing.
