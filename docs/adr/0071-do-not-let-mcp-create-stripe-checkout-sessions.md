# Do not let MCP create Stripe Checkout sessions

MCP tools will not actively create Stripe Checkout sessions in the first release. Billing checkout is initiated through Web or CLI, while MCP quota and plan-limit responses may include an upgrade link or instruction to continue in Web/CLI.
