# Remove legacy OAuth password authorization on new identity launch

When the new GitHub/email identity system launches, the existing shared authorization-password flow will be removed rather than kept as a compatibility path. Existing CLI and MCP clients must re-authorize through the new login flow, eliminating the shared-password security model before public SaaS onboarding opens.
