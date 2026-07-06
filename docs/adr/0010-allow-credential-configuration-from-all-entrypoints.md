# Allow credential configuration from Web, CLI, and MCP

We will allow Web, CLI, and authorized MCP tools to configure or rotate WeChat AppID/AppSecret credentials through the same backend use case. This preserves parity between entrypoints while centralizing encryption, scope checks, audit logging, and secret redaction in the hosted service rather than storing WeChat secrets in clients.
