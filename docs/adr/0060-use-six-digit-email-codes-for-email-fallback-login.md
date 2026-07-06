# Use six-digit email codes for fallback login

The email fallback identity flow will send six-digit verification codes rather than magic links. Codes work reliably with the CLI-opened browser OAuth flow and avoid accidental login completion in a different browser or device session.
