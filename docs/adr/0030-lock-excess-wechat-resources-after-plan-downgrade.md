# Lock excess WeChat resources after plan downgrade

When a tenant downgrades below its current WeChat resource count, the SaaS will not delete credentials or data. It will keep resources stored but lock excess resources beyond the new account allowance until the tenant upgrades again or the owner removes resources manually.
