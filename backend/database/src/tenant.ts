import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * The tables that hold an organization's data (docs/planning/06 §5, ADR-008).
 *
 * `organizations` is the tenancy root, not a tenant-scoped table. `users`,
 * `login_attempts` and `refresh_tokens` are deliberately absent: identity is not
 * tenant-owned, and a refresh token is reached through the session that owns it.
 *
 * Anything not listed here is refused by the scope rather than queried unfiltered,
 * so leaving a table out breaks loudly instead of leaking.
 */
export const TENANT_MODELS = [
  "memberships",
  "invitations",
  "sessions",
  "idempotency_keys",
  "audit_events",
] as const;

const TENANT_MODEL_SET: ReadonlySet<string> = new Set(TENANT_MODELS);

/**
 * Relation fields on the tenant models, by model.
 *
 * They are refused on write: the relation form carries the organization as an
 * object rather than the scalar `organization_id` this scope stamps, so it could
 * name a different organization — and a nested create would add rows the scope
 * never filters. Callers use the scalar foreign key (`user_id`) instead.
 *
 * Drift between this map and prisma/schema.prisma is caught by test/schema.test.ts.
 */
export const RELATION_FIELDS: Record<string, readonly string[]> = {
  memberships: ["user", "organization", "inviter"],
  invitations: ["organization", "inviter"],
  sessions: ["user", "organization", "refresh_tokens"],
  idempotency_keys: ["organization"],
  audit_events: ["organization", "user"],
};

/** Raised when a caller asks an organization scope to do something it cannot make safe. */
export class TenantScopeError extends Error {
  override readonly name = "TenantScopeError";
}

/** Reads take a filter; writes take a filter and a payload. */
const FILTERED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const CREATING_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

type Args = Record<string, unknown>;

function asArgs(value: unknown): Args {
  return value !== null && typeof value === "object" ? { ...(value as Args) } : {};
}

function rowsOf(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [data];
}

function refuseRelationWrites(model: string, data: unknown): void {
  const relations = RELATION_FIELDS[model] ?? [];
  for (const row of rowsOf(data)) {
    if (row === null || typeof row !== "object") continue;
    const offending = relations.filter((field) => field in row);
    if (offending.length > 0) {
      throw new TenantScopeError(
        `${model}: relation write via ${offending.join(", ")} would escape the organization filter; set the scalar foreign key instead`,
      );
    }
  }
}

/** Stamps the scope's organization onto every row being created. */
function bindOrganization(model: string, data: unknown, organizationId: string): unknown {
  const bound = rowsOf(data).map((row) => {
    if (row === null || typeof row !== "object") {
      throw new TenantScopeError(`${model}: refusing to create a row that is not an object`);
    }
    const given = (row as Args).organization_id;
    if (given !== undefined && given !== organizationId) {
      throw new TenantScopeError(
        `${model}: create named organization ${String(given)} outside the current scope`,
      );
    }
    return { ...(row as Args), organization_id: organizationId };
  });
  return Array.isArray(data) ? bound : bound[0];
}

/** A write must not be able to hand a row to another organization. */
function refuseTenancyMove(model: string, data: unknown, organizationId: string): void {
  for (const row of rowsOf(data)) {
    if (row === null || typeof row !== "object") continue;
    const given = (row as Args).organization_id;
    if (given !== undefined && given !== organizationId) {
      throw new TenantScopeError(
        `${model}: refusing to move a row into organization ${String(given)}`,
      );
    }
  }
}

function withOrganization(where: unknown, organizationId: string): Args {
  // Spread first, then set: the scope's own filter always wins, so a caller
  // cannot widen it by passing their own organization_id.
  return { ...asArgs(where), organization_id: organizationId };
}

function rawSqlRefused(operation: string): never {
  throw new TenantScopeError(
    `${operation} is not available through an organization scope; it would bypass the organization filter`,
  );
}

/**
 * A view of the database that can only reach one organization's data (ADR-008).
 *
 * Every read and write against a tenant table has its `organization_id` filter
 * injected, and a create has its `organization_id` stamped on. Anything the
 * scope cannot make safe — a nested relation write, an operation it does not
 * understand, or a model that is not tenant-scoped — raises
 * `TenantScopeError` rather than falling through to an unfiltered query.
 */
export function forOrganization<C extends PrismaClient>(prisma: C, organizationId: string) {
  return prisma.$extends({
    name: "organization-scope",
    // Raw SQL never reaches the model rules above, so a scope simply does not
    // have it. Without this the fail-closed claim below would only be true for
    // queries that happen to use the model API.
    client: {
      $queryRaw: (..._args: unknown[]) => rawSqlRefused("$queryRaw"),
      $queryRawUnsafe: (..._args: unknown[]) => rawSqlRefused("$queryRawUnsafe"),
      $executeRaw: (..._args: unknown[]) => rawSqlRefused("$executeRaw"),
      $executeRawUnsafe: (..._args: unknown[]) => rawSqlRefused("$executeRawUnsafe"),
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODEL_SET.has(model)) {
            throw new TenantScopeError(
              `${model} is not organization-scoped; use the unscoped client for identity tables`,
            );
          }

          const next = asArgs(args);
          if (CREATING_OPS.has(operation)) {
            refuseRelationWrites(model, next.data);
            next.data = bindOrganization(model, next.data, organizationId);
          } else if (operation === "upsert") {
            refuseRelationWrites(model, next.create);
            refuseRelationWrites(model, next.update);
            refuseTenancyMove(model, next.update, organizationId);
            next.create = bindOrganization(model, next.create, organizationId);
            next.where = withOrganization(next.where, organizationId);
          } else if (FILTERED_OPS.has(operation)) {
            if (next.data !== undefined) {
              refuseRelationWrites(model, next.data);
              refuseTenancyMove(model, next.data, organizationId);
            }
            next.where = withOrganization(next.where, organizationId);
          } else {
            throw new TenantScopeError(
              `${model}.${operation} is not supported through an organization scope`,
            );
          }

          return query(next);
        },
      },
    },
  });
}
