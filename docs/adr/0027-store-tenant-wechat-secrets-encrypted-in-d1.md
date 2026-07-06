# Store tenant WeChat secrets encrypted in D1

Tenant WeChat AppSecrets, webhook tokens, EncodingAESKeys, and access tokens will be stored in D1 using the existing `enc:` AES encryption model backed by `WECHAT_MCP_SECRET_KEY`. API, CLI, MCP, audit, and logs must only expose masked secret presence and never return raw secret values.
