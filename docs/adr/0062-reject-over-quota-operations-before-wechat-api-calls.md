# Reject over-quota operations before WeChat API calls

When a tenant exceeds its account, tool-call, or publish allowance, the SaaS will reject the operation before calling the WeChat API and return quota details, reset timing, and an upgrade path. It will not allow implicit overage billing in the first release.
