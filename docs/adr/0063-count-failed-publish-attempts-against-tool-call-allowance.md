# Count failed publish attempts against tool-call allowance

Failed publish attempts will consume the tenant's general tool-call allowance because they still use platform and possibly WeChat API capacity, but they will not consume the separate successful published content allowance.
