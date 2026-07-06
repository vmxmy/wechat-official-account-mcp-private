# Use shared types and Zod boundaries for the Web API client

The Web API client will use shared TypeScript types for stable response shapes and Zod parsing at key boundaries such as `/me`, onboarding status, account configuration, billing, quotas, and sessions. This prevents the Web entrypoint from guessing backend fields and catches response drift early.
