import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@ua/database";
import type { Logger } from "@ua/logger";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { LOGGER } from "../logging.module.js";

/**
 * The **unscoped** Prisma client (ADR-008).
 *
 * Tenant rows are reachable only through `forOrganization`, which stamps and
 * filters `organization_id`. This class exists for the code that runs before a
 * tenant is known — registering, signing in, listing which organizations a user
 * belongs to — and for the tenancy root itself, since `organizations` is not an
 * organization-scoped table.
 *
 * That is why it is confined to `src/identity`, `src/auth`, `src/organizations`,
 * `src/audit`, the readiness probe in `src/health`, and the task/session
 * repositories that use it only to build a `forOrganization` scope:
 * `test/unscoped-client.test.ts` fails if any other module injects it.
 */
@Injectable()
export class UnscopedDatabase implements OnModuleInit, OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  /** Connect at boot: a bad DATABASE_URL should stop the process, not a request. */
  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.info("database connected");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
