## ADDED Requirements

### Requirement: HTTP executor interface for Workers runtime
The system SHALL define an `HttpExecutor` interface that abstracts outbound HTTP to WeChat, and `WechatApiClient` SHALL depend only on this interface. The production runtime SHALL use `WorkersHttpExecutor` (Web `fetch` + Web `FormData` + `Uint8Array`/`ArrayBuffer`) wrapped by `AccessTokenHttpExecutor`. Node/Axios executor code SHALL NOT be part of the runtime or build output.

#### Scenario: Workers executor emits correct requests
- **WHEN** `WechatApiClient` invokes GET, JSON POST, multipart POST, or arraybuffer download through the Workers executor
- **THEN** the generated URL, headers, body kind, and response shape match WeChat API expectations

### Requirement: Shared business methods, no duplication
The existing `WechatApiClient` methods SHALL be written once against `HttpExecutor` and SHALL NOT be duplicated by runtime. Runtime-specific behavior belongs only in executor/media wrapper seams.

#### Scenario: Adding a new WeChat endpoint
- **WHEN** a new API method is added to `WechatApiClient`
- **THEN** it is implemented once and works on Workers with no Node-specific branch

### Requirement: Automatic token injection preserved
The `AccessTokenHttpExecutor` SHALL inject the current Access Token into WeChat requests automatically, so tool handlers and API methods never add `access_token` to URLs manually.

#### Scenario: Token injected without caller action
- **WHEN** any method calls a WeChat endpoint that requires a token
- **THEN** the executor obtains the token from `TokenOwner` and appends it unless the URL already contains `access_token`

### Requirement: No raw response body in logs
The executor SHALL log only HTTP status / WeChat `errcode`/`errmsg` on failure and SHALL NOT log full response bodies.

#### Scenario: Failed request logged safely
- **WHEN** a WeChat request fails with a non-2xx status or `errcode`
- **THEN** the log entry contains only status code and WeChat error message, never the response body
