import { Global, Module } from "@nestjs/common";
import { UnscopedDatabase } from "./unscoped-database.js";

/**
 * Owns the database client.
 *
 * There is deliberately no `forOrganization` convenience wrapper here: tenant
 * code imports the scope from `@ua/database` directly, so the organization
 * filter is visible where it is used rather than hidden behind a service method
 * (ADR-008).
 */
@Global()
@Module({ providers: [UnscopedDatabase], exports: [UnscopedDatabase] })
export class DatabaseModule {}
