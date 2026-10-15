/**
 * `@ua/contracts` — the single source of truth for every wire schema
 * (docs/planning/03 §5.8).
 *
 * Trust boundary: any payload crossing a process, network, queue or storage
 * boundary must be parsed by a schema from this package before it is used. If a
 * shape is not here, it is not a contract, and it must not be trusted.
 *
 * Depends on Zod only — no framework, no database, no I/O.
 */
export * from "./common.js";
export * from "./errors.js";
export * from "./registry.js";
export * from "./risk.js";
export * from "./task.js";
