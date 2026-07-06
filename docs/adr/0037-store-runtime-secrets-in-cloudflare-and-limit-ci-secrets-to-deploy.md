# Store runtime secrets in Cloudflare and limit CI secrets to deploy

Production runtime secrets for GitHub OAuth, Resend, Stripe, WeChat relay, and encryption will be stored in Cloudflare secret bindings or Secrets Store. GitHub Actions should hold only the Cloudflare deployment credentials needed to deploy the Worker, not business runtime secrets.
