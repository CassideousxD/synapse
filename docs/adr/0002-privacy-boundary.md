# ADR 0002: packages/sync is the only egress for student data
Only AnalysisPayload (validated against contracts/schemas, no extra fields)
leaves the device. Enforced by .dependency-cruiser.cjs + schema validation.
The LLM proxy in apps/api is stateless and must not log request bodies.
