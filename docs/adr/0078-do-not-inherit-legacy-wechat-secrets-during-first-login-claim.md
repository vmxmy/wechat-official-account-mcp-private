# Do not inherit legacy WeChat secrets during first-login claim

When public signup opens directly and the first Operator login claims the legacy default tenant shell, old WeChat AppSecret, webhook credentials, and access tokens will not be inherited into an active resource. The Operator must reconfigure and validate credentials before any WeChat API operation can run for that resource.
