// Must load the reflect-metadata polyfill before any decorated class (AppModule
// and its providers) is evaluated, or Nest's scanner throws a TypeError at boot.
import "reflect-metadata";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Logger } from "@ua/logger";
import { AppModule } from "./app.module.js";
import { ProblemDetailsFilter } from "./common/problem-details.filter.js";
import { requestContext } from "./common/request-context.js";
import { loadConfig } from "./config.js";
import { LOGGER } from "./logging.module.js";

/**
 * Creates the Fastify + Nest application without binding a port, so the same
 * assembly can be used by the production entrypoint and by the integration test
 * harness (docs/planning/07).
 */
export async function createApp(config = loadConfig()): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: config.trustProxy,
    // The default body limit (1 MiB) is enough; a too-large body hits the filter
    // as `payload_too_large` via Nest/Fastify rather than a generic 500.
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    // The platform logger is injected; silence Nest's own logs.
    logger: false,
  });

  await app.register(cookie);
  const fastify = app.getHttpAdapter().getInstance();

  // Correlation ids before anything else: the guard and all handlers can assume
  // `request.context` exists.
  fastify.addHook("onRequest", async (request, reply) => {
    const context = requestContext(request.headers);
    request.context = context;
    reply.header("x-request-id", context.requestId);
    reply.header("traceparent", context.traceId);
  });

  const logger = await app.resolve<Logger>(LOGGER);
  app.useGlobalFilters(new ProblemDetailsFilter(logger));

  await app.init();
  return app;
}
