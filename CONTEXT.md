# WeChat Official Account SaaS

This context defines the business language for the hosted WeChat Official Account MCP SaaS: how people, tenants, WeChat accounts, subscription plans, and client entrypoints relate during onboarding and operation.

## Language

**Onboarding**:
The end-to-end path that turns a new operator into an authenticated SaaS user with an accessible tenant, at least one WeChat Official Account resource, and configured WeChat credentials.
_Avoid_: setup, install, registration flow

**Operator**:
A human user who signs in to the SaaS and manages one or more tenant-owned WeChat Official Account resources.
_Avoid_: user, admin, customer

**Operator identity**:
The internal identity record for an Operator, which may be linked to one or more verified external identities such as GitHub or email fallback.
_Avoid_: login, account, profile

**Tenant**:
An organization-level boundary that owns WeChat Official Account resources, memberships, quotas, billing state, and audit history.
_Avoid_: workspace, org, account

**Default tenant**:
The first tenant automatically created for a new Operator during onboarding. It exists to give every Operator an immediate ownership boundary before they invite others or create additional tenants.
_Avoid_: personal workspace, initial org, bootstrap tenant

**Tenant owner**:
The Operator who controls a tenant during the first release and is allowed to configure that tenant's WeChat Official Account resources and billing state.
_Avoid_: admin, creator, super user

**WeChat Official Account resource**:
A tenant-owned representation of one WeChat Official Account, including its AppID/AppSecret configuration, webhook settings, tokens, media, drafts, publishes, and inbox messages.
_Avoid_: account, official account config, app config

**Unconfigured WeChat Official Account resource**:
A WeChat Official Account resource that exists under a tenant but does not yet have valid WeChat AppID/AppSecret credentials.
_Avoid_: empty account, pending account, placeholder config

**Credential configuration**:
The act of attaching or rotating WeChat AppID/AppSecret and webhook credentials for a WeChat Official Account resource.
_Avoid_: auth setup, secret update, app setup

**Credential validation**:
The verification step that proves submitted WeChat credentials can obtain a valid WeChat access token before the WeChat Official Account resource becomes active.
_Avoid_: token test, config check, auth validation

**Platform relay**:
The SaaS-owned HTTPS relay used as the fixed outbound network path for WeChat API calls that require WeChat IP allowlisting.
_Avoid_: proxy, tunnel, forwarder

**Active WeChat Official Account resource**:
A WeChat Official Account resource whose credentials have passed validation and can be used for WeChat API operations.
_Avoid_: configured account, connected account, live account

**Account allowance**:
The maximum number of WeChat Official Account resources a tenant may configure under its current subscription plan.
_Avoid_: account quota, account cap, max accounts

**Published content allowance**:
The monthly number of successful content publish operations a tenant may complete under its current subscription plan. Failed attempts and draft creation do not consume this allowance.
_Avoid_: article quota, post quota, publish credits

**Published content**:
A WeChat article or image/贴图 item successfully submitted through the official publish flow for a tenant's active WeChat Official Account resource.
_Avoid_: post, message, media item

**Tool call allowance**:
The monthly number of MCP, CLI, or API operation calls a tenant may make across the hosted SaaS entrypoints under its current subscription plan.
_Avoid_: API quota, request cap, usage limit

**Subscription**:
The billing relationship that assigns a subscription plan and its allowances to a tenant.
_Avoid_: payment, membership, license

**Subscription plan**:
A named SaaS package such as Free, Plus, or Pro that determines a tenant's allowances.
_Avoid_: tier, package, product

**Audit log**:
A tenant-scoped record of security-relevant or public-impacting actions such as login, credential configuration, publishing, deletion, billing changes, and quota rejections.
_Avoid_: event log, activity feed, operation history

**Entrypoint**:
A client surface through which an operator reaches the same hosted SaaS backend, such as Web, CLI, or MCP.
_Avoid_: frontend, client, interface

**Identity provider**:
An external login authority that proves an Operator identity to the SaaS, after which the SaaS maps that identity to internal tenant memberships and permissions.
_Avoid_: OAuth app, login method, auth vendor

**Fallback identity flow**:
A secondary login path for Operators who cannot use the primary Identity provider, while still producing the same internal Operator identity and tenant memberships.
_Avoid_: backup login, alternate auth, manual account

**Web entrypoint**:
The browser-based entrypoint used for first-time signup, OAuth authorization UX, Stripe checkout return handling, and guided credential setup.
_Avoid_: dashboard, website, frontend

**CLI entrypoint**:
The command-line entrypoint that can complete developer-oriented onboarding and operations by calling the hosted API without storing WeChat secrets locally.
_Avoid_: local mode, desktop MCP, stdio client

**MCP entrypoint**:
The Streamable HTTP MCP entrypoint used by authorized AI clients to manage tenant/account context and WeChat operations after OAuth authorization.
_Avoid_: local MCP, SSE MCP, stdio MCP
