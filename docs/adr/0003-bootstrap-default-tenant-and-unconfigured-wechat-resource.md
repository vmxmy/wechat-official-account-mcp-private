# Bootstrap a default tenant and unconfigured WeChat resource on first login

When an Operator completes first login, we will automatically create a default tenant and one unconfigured WeChat Official Account resource owned by that tenant. This keeps Web, CLI, and MCP onboarding short because the next required action is credential configuration rather than separate tenant/account provisioning, while still allowing rename and additional resources later.
