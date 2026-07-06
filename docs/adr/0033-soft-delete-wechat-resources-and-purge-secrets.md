# Soft-delete WeChat resources and purge secrets

Deleting a WeChat Official Account resource will disable the resource and purge its AppSecret, webhook credentials, and access tokens rather than hard-deleting all related rows. This preserves non-sensitive auditability and support context while reducing the retained secret surface after deletion.
