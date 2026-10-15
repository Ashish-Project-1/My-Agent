// The tenant-scoped data-access layer (ADR-008). Every tenant-table read and
// write goes through here so that an organization filter cannot be forgotten.
export { PrismaClient } from "./generated/prisma/client.js";
