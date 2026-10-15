import * as runtime from "@prisma/client/runtime/client";
import * as $Class from "./internal/class.ts";
import * as Prisma from "./internal/prismaNamespace.ts";
export * as $Enums from './enums.ts';
export * from "./enums.ts";
/**
 * ## Prisma Client
 *
 * Type-safe database client for TypeScript
 * @example
 * ```
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 * // Fetch zero or more Users
 * const users = await prisma.users.findMany()
 * ```
 *
 * Read more in our [docs](https://pris.ly/d/client).
 */
export declare const PrismaClient: $Class.PrismaClientConstructor;
export type PrismaClient<LogOpts extends Prisma.LogLevel = never, OmitOpts extends Prisma.PrismaClientOptions["omit"] = Prisma.PrismaClientOptions["omit"], ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = $Class.PrismaClient<LogOpts, OmitOpts, ExtArgs>;
export { Prisma };
/**
 * Model users
 *
 */
export type users = Prisma.usersModel;
/**
 * Model organizations
 *
 */
export type organizations = Prisma.organizationsModel;
/**
 * Model memberships
 *
 */
export type memberships = Prisma.membershipsModel;
/**
 * Model invitations
 *
 */
export type invitations = Prisma.invitationsModel;
/**
 * Model sessions
 *
 */
export type sessions = Prisma.sessionsModel;
/**
 * Model refresh_tokens
 *
 */
export type refresh_tokens = Prisma.refresh_tokensModel;
/**
 * Model login_attempts
 *
 */
export type login_attempts = Prisma.login_attemptsModel;
/**
 * Model idempotency_keys
 *
 */
export type idempotency_keys = Prisma.idempotency_keysModel;
/**
 * Model audit_events
 *
 */
export type audit_events = Prisma.audit_eventsModel;
//# sourceMappingURL=client.d.ts.map