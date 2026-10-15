import { IdempotencyKey, Money, Timestamp, Ulid, Uuid } from "./common.js";
import { ErrorCode, FieldError, ProblemDetails } from "./errors.js";
import { RiskClass } from "./risk.js";
import { ExecutionLocation, StepKind, TaskState } from "./task.js";

/**
 * Schemas emitted as OpenAPI `components.schemas` by
 * `scripts/generate-openapi.mjs`. Only body and response shapes belong here —
 * query parameters (which are not components) are described at the endpoint.
 *
 * The generator iterates this map, so a new wire schema that is not registered
 * here is simply absent from the document: registering it is part of adding it.
 */
export const SCHEMAS = {
  Uuid,
  Ulid,
  IdempotencyKey,
  Timestamp,
  Money,
  ErrorCode,
  FieldError,
  ProblemDetails,
  TaskState,
  StepKind,
  ExecutionLocation,
  RiskClass,
} as const;
