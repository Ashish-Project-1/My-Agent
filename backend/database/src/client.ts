import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Prisma 7 reaches PostgreSQL through a driver adapter, so the connection string
 * arrives here rather than from the schema's datasource block. Callers own the
 * lifecycle: `$disconnect()` when done.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
