// The data-access layer for identity, tenancy and the audit trail
// (docs/planning/06, ADR-008). Tenant rows are reached only through
// `forOrganization`, so an organization filter cannot be forgotten.
export { createPrismaClient } from "./client.js";
export type { PrismaClient } from "./generated/prisma/client.js";
// The stored vocabulary the layers above must be able to name, re-exported so
// they never reach into `src/generated` directly.
export type {
  AuditActorType,
  AuditResult,
  OrgStatus,
  SessionRevokedReason,
  UserStatus,
} from "./generated/prisma/enums.js";
export { forOrganization, TenantScopeError } from "./tenant.js";
