/**
 * `@ua/logger` — structured logging with a redaction deny-list
 * (docs/planning/03 §5.12).
 *
 * Everything written through this package is redacted before serialisation. Do
 * not log with `console` outside of bootstrap code that has no logger yet.
 */
export * from "./logger.js";
export * from "./redact.js";
