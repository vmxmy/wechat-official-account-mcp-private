## ADDED Requirements

### Requirement: Runtime-agnostic HTTP interface
The system SHALL define an `HttpExecutor` interface that abstracts outbound HTTP to WeChat, and `WechatApiClient` SHALL depend only on this interface. Two implementations SHALL exist: a Node implementation (current `axios` + Node `form-data`) and a Workers implementation (Web `fetch` + Web `FormData` + `Uint8Array`/`ArrayBuffer`).

#### Scenario: Identical behavior across runtimes
- **WHEN** the same `WechatApiClient` method is invoked on Node and on Workers
- **THEN** both produce the same WeChat API call (URL, multipart body, headers) and return the same result shape

### Requirement: Shared business methods, no duplication
The 46 existing `WechatApiClient` methods SHALL be written once against `HttpExecutor` and SHALL NOT be duplicated between runtimes. Only the executor implementations differ.

#### Scenario: Adding a new WeChat endpoint
- **WHEN** a new API method is added to `WechatApiClient`
- **THEN** it is implemented once and works on both Node and Workers with no runtime-specific code

### Requirement: Automatic token injection preserved
The `HttpExecutor` SHALL continue to inject the current Access Token into WeChat requests automatically, so tool handlers and API methods never add `access_token` to URLs manually. This behavior MUST be runtime-agnostic.

#### Scenario: Token injected without caller action
- **WHEN** any method calls a WeChat endpoint that requires a token
- **THEN** the executor obtains the token from the shared token owner and appends it, on both runtimes

### Requirement: No raw response body in logs
The executor SHALL log only HTTP status / WeChat `errcode`/`errmsg` on failure and SHALL NOT log full response bodies, preserving the current data-leak prevention on both runtimes.

#### Scenario: Failed request logged safely
- **WHEN** a WeChat request fails with a non-2xx status or `errcode`
- **THEN** the log entry contains only status code and WeChat error message, never the response body
