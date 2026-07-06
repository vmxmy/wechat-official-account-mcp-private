# Assign the legacy default tenant shell to the first Operator without inheriting secrets

During SaaS migration, the existing `tenant_default/acct_default` tenant/account identity and non-secret historical context may be preserved, but old WeChat secrets must not be automatically inherited by the first public Operator login. The claimed WeChat Official Account resource must require fresh credential configuration before becoming active, preventing accidental transfer of existing公众号 control if public signup opens before the intended owner logs in.
