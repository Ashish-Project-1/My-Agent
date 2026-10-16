/**
 * True when Prisma rejected a write because a value in `column` already exists.
 *
 * Prisma exposes the offending index under one of three shapes: the field list
 * (`meta.target`), the generated constraint name, or — with the driver adapters
 * Prisma 7 uses — `meta.driverAdapterError.cause.constraint.index`. Matching the
 * column rather than a full index name keeps the check working across a
 * migration that renames an index.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
    };
  };
  if (candidate.code !== "P2002") {
    return false;
  }

  const identifiers: string[] = [];
  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    for (const entry of target) {
      if (typeof entry === "string") {
        identifiers.push(entry);
      }
    }
  } else if (typeof target === "string") {
    identifiers.push(target);
  }
  const index = candidate.meta?.driverAdapterError?.cause?.constraint?.index;
  if (typeof index === "string") {
    identifiers.push(index);
  }

  return identifiers.some(
    (entry) =>
      entry === column || entry.endsWith(`_${column}_key`) || entry.endsWith(`_${column}_idx`),
  );
}
