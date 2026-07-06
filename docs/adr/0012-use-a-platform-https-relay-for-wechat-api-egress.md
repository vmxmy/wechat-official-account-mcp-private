# Use a platform HTTPS relay for WeChat API egress

The SaaS will route WeChat API calls through a platform-owned HTTPS relay with a stable allowlisted IP rather than requiring each tenant to bring its own proxy. This makes credential validation and normal operations predictable for Cloudflare Workers while keeping tenant onboarding focused on adding the documented platform IP to the WeChat Official Account allowlist.
