# Require Turnstile for email code requests in Web and CLI OAuth flows

Email-code requests must pass Turnstile in both normal Web login and the browser authorization page opened by `woa login`. This closes the public email verification abuse path regardless of which entrypoint initiated login.
