# Use Resend for email identity fallback

The email fallback identity flow will send verification codes or magic links through Resend. This keeps the first release focused on a simple transactional email API that works from Cloudflare Workers while preserving GitHub as the primary login path.
