import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import schema from "@synapse/contracts/schemas/analysis-payload.schema.json" with { type: "json" };
import type { AnalysisPayload } from "@synapse/contracts";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateFn: ValidateFunction<AnalysisPayload> = ajv.compile(schema);

export class InvalidPayloadError extends Error {
  constructor(public readonly details: string) {
    super(`AnalysisPayload failed validation: ${details}`);
    this.name = "InvalidPayloadError";
  }
}

/** The privacy boundary made real: nothing crosses without passing this. */
export function assertValidPayload(payload: unknown): AnalysisPayload {
  if (!validateFn(payload)) {
    throw new InvalidPayloadError(ajv.errorsText(validateFn.errors, { separator: "; " }));
  }
  return payload as AnalysisPayload;
}
