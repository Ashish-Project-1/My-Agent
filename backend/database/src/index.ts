// The data-access layer for identity, tenancy and the audit trail
// (docs/planning/06, ADR-008). Tenant rows are reached only through
// `forOrganization`, so an organization filter cannot be forgotten.
export { createPrismaClient } from "./client.js";
export type { PrismaClient } from "./generated/prisma/client.js";
export { forOrganization, TenantScopeError } from "./tenant.js";
