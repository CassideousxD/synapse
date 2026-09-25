import { Ajv, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

export type JsonSchema = Record<string, unknown>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface Validator<T> {
  /** Used in error and repair messages, e.g. "Diagnosis". */
  readonly name: string;
  validate(data: unknown): ValidationResult<T>;
}

const MAX_ERRORS = 8;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

function formatError(e: ErrorObject): string {
  const where = e.instancePath === "" ? "(root)" : e.instancePath;
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "additionalProperties":
      return `${where}: unexpected property "${String(p.additionalProperty)}"`;
    case "enum":
      return `${where}: must be one of ${JSON.stringify(p.allowedValues)}`;
    case "required":
      return `${where}: missing required property "${String(p.missingProperty)}"`;
    default:
      return `${where}: ${e.message ?? "is invalid"}`;
  }
}

export function createValidator<T>(name: string, schema: JsonSchema): Validator<T> {
  const check = ajv.compile(schema);
  return {
    name,
    validate(data) {
      if (check(data)) return { ok: true, value: data as T };
      return { ok: false, errors: (check.errors ?? []).slice(0, MAX_ERRORS).map(formatError) };
    },
  };
}

/**
 * A schema containing only `keys` of `schema`. Used to build the "what the LLM may produce"
 * schema from a contract schema, so the model can't set ids/timestamps and there's one source of truth.
 */
export function pickSchema(schema: JsonSchema, keys: string[]): JsonSchema {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = (schema.required ?? []) as string[];
  const unknown = keys.filter((k) => !(k in props));
  if (unknown.length > 0) throw new Error(`pickSchema: unknown propert${unknown.length > 1 ? "ies" : "y"} ${unknown.join(", ")}`);
  return {
    ...schema,
    title: `${String(schema.title ?? "Schema")}Draft`,
    properties: Object.fromEntries(keys.map((k) => [k, props[k]])),
    required: required.filter((k) => keys.includes(k)),
    additionalProperties: false,
  };
}

/** Add semantic rules a JSON schema can't express. Return human-readable problems; [] means fine. */
export function refine<T>(base: Validator<T>, check: (value: T) => string[]): Validator<T> {
  return {
    name: base.name,
    validate(data) {
      const r = base.validate(data);
      if (!r.ok) return r;
      const problems = check(r.value);
      return problems.length === 0 ? r : { ok: false, errors: problems.slice(0, MAX_ERRORS) };
    },
  };
}
