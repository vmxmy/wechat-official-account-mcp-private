# Use seven-day sliding Web sessions

Web HttpOnly sessions will use a seven-day sliding expiration and become invalid immediately on logout or server-side revocation. This balances frequent SaaS use with a bounded browser session lifetime.
