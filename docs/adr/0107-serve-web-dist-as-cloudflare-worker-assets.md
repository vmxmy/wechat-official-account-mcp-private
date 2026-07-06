# Serve web/dist as Cloudflare Worker assets

The dedicated `web/` Vite app will build to `web/dist`, and the Cloudflare Worker will serve that directory as its static assets while continuing to own `/api`, `/mcp`, `/oauth`, `/auth`, Stripe webhook, and WeChat callback routes. The Web app will not be deployed as a separate Cloudflare Pages project in the first release.
