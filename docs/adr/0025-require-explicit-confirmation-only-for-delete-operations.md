# Require explicit confirmation only for delete operations

The first release will require explicit confirmation markers for delete operations, while publish, mass-send, menu updates, and other non-delete writes rely on authentication, owner authorization, quotas, and audit logging rather than an extra confirmation parameter. This favors smoother content operations while preserving guardrails for destructive deletion.
