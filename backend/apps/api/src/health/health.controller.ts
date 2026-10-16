import { Controller, Get } from "@nestjs/common";
import type { PrismaClient } from "@ua/database";
import { Public } from "../common/public.decorator.js";
// Value import: Nest reads the injected token from decorator metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";

/**
 * Liveness and readiness (docs/planning/16 §2).
 *
 * `/healthz` is pure liveness: the process can respond. `/readyz` performs a
 * single no-op read to the database to catch a broken pool or a failed migration
 * before routing traffic to the instance.
 */
@Controller()
export class HealthController {
  private readonly prisma: PrismaClient;

  constructor(database: UnscopedDatabase) {
    this.prisma = database.client;
  }

  @Public()
  @Get("healthz")
  healthz(): { status: "ok" } {
    return { status: "ok" };
  }

  @Public()
  @Get("readyz")
  async readyz(): Promise<{ status: "ok" }> {
    // A real SELECT 1 against the pool: succeeds only if a connection exists.
    await this.prisma.$queryRaw<[{ status: number }]>`SELECT 1`;
    return { status: "ok" };
  }
}
