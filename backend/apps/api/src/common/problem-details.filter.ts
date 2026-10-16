import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from "@nestjs/common";
import type { ErrorCode } from "@ua/contracts";
import { AppError, isAppError, toProblemDetails } from "@ua/error-handling";
import type { Logger } from "@ua/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LOGGER } from "../logging.module.js";
import { requestContext } from "./request-context.js";

/**
 * Maps a status Nest raised onto the platform's closed error code set
 * (docs/planning/07 §2). The set has no `method_not_allowed`, so a 405 is
 * reported as `not_found` — the answer a client is least likely to act on
 * differently. Nothing else is invented: the code set is closed on purpose.
 */
const CODE_FOR_STATUS: Record<number, ErrorCode> = {
  400: "invalid_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  405: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "invalid_request",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
  503: "service_unavailable",
};

/** Static, user-safe text per code. A framework message is never forwarded. */
const DETAIL_FOR_CODE: Record<ErrorCode, string> = {
  invalid_request: "The request could not be understood.",
  validation_failed: "The request failed validation.",
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have access to this resource.",
  insufficient_role: "Your role does not permit this action.",
  not_found: "The requested resource does not exist.",
  conflict: "The request conflicts with the current state.",
  idempotency_conflict: "This request was already made with a different body.",
  state_conflict: "The resource is not in a state that allows this.",
  approval_expired: "The approval expired before it was used.",
  gone: "The resource has been removed.",
  payload_too_large: "The request body is too large.",
  unprocessable_entity: "The request is well formed but cannot be applied.",
  rate_limited: "Too many requests. Try again later.",
  internal_error: "An unexpected error occurred. Quote the requestId when reporting it.",
  bad_gateway: "An upstream service returned an unusable response.",
  service_unavailable: "The service is temporarily unavailable.",
  gateway_timeout: "An upstream service did not respond in time.",
};

/**
 * Only an `AppError` carries text we chose. Anything else — including a Nest
 * `HttpException`, whose message may quote a path or an input — is reduced to a
 * static sentence, so a response can never leak more than the code says
 * (docs/planning/07 §2).
 */
function asAppError(exception: unknown): unknown {
  if (isAppError(exception)) {
    return exception;
  }
  if (exception instanceof HttpException) {
    const code = CODE_FOR_STATUS[exception.getStatus()] ?? "internal_error";
    return new AppError(code, DETAIL_FOR_CODE[code]);
  }
  return exception;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const context = request.context ?? requestContext(request.headers);

    const problem = toProblemDetails(asAppError(exception), {
      instance: request.url,
      requestId: context.requestId,
      traceId: context.traceId,
    });

    // The client gets a fixed sentence; the operator gets the cause. This is the
    // only place an exception's own text is allowed to exist.
    if (problem.status >= 500) {
      this.logger.error("request failed", {
        requestId: context.requestId,
        traceId: context.traceId,
        method: request.method,
        path: request.url,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    if (!reply.raw.writableEnded) {
      void reply.status(problem.status).type("application/problem+json").send(problem);
    }
  }
}
