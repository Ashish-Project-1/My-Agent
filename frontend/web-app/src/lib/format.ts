/** Renders an ISO timestamp for humans, and nothing at all when it is not a
 * date — a malformed timestamp should leave a gap, not print `Invalid Date`. */
export function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}
