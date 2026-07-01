## ADDED Requirements

### Requirement: Globally unique token owner
The system SHALL designate a single Durable Object instance (or a single D1 row guarded by a DO) as the sole owner of the WeChat Access Token refresh across all Worker invocations, sessions, and edge regions. Per-request or per-instance token refresh SHALL NOT occur.

#### Scenario: Concurrent requests reuse one token
- **WHEN** multiple Worker requests require an Access Token simultaneously
- **THEN** at most one refresh request is sent to `https://api.weixin.qq.com/cgi-bin/token`, and all requests receive the same valid token

#### Scenario: Multi-region coalescing
- **WHEN** requests arrive at different edge regions within the token lifetime
- **THEN** they all read the shared token from the DO/D1 source and no region refreshes independently

### Requirement: Proactive pre-expiry refresh
The system SHALL refresh the Access Token before it expires, scheduled via the DO's `schedule()` or alarm API, so that no request blocks on a synchronous token refresh under normal conditions.

#### Scenario: Token refreshed before expiry
- **WHEN** the current token is within 5 minutes of its `expires_at`
- **THEN** the DO refreshes it ahead of time and persists the new token, and the next client request receives the already-valid token without waiting

### Requirement: Persistence across eviction
The current Access Token and its expiry SHALL be persisted to durable storage (D1 or DO storage) so that a DO eviction, hibernation wake, or Worker cold start does not force a redundant refresh or lose the token.

#### Scenario: Cold start retains token
- **WHEN** the Worker cold-starts after an eviction
- **THEN** the system loads the still-valid token from durable storage and serves requests without calling WeChat's token endpoint

### Requirement: Refresh failure surfaces error
The system SHALL propagate refresh failures (e.g. WeChat `errcode`) to the caller and SHALL NOT cache a known-invalid token.

#### Scenario: WeChat rejects refresh
- **WHEN** WeChat returns an `errcode` to the token refresh call
- **THEN** the calling tool returns a clear error containing the `errcode`/`errmsg`, and no token is written to storage
