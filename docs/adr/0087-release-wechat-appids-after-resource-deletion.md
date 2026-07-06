# Release WeChat AppIDs after resource deletion

When a WeChat Official Account resource is soft-deleted and its secrets are purged, its AppID becomes available for configuration on another resource. Audit history should preserve the prior association without blocking legitimate rebinding.
