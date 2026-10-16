import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "ua:public";

/**
 * Marks a route as reachable without a session.
 *
 * The global `AuthGuard` denies by default, so a route added without this
 * decorator is authenticated whether or not its author thought about it
 * (docs/planning/11 §5 "Authorisation": guards, so it cannot be forgotten).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
