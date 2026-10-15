import { redactValue } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  /** Service or worker name, e.g. `api`, `worker-code`. Always emitted. */
  service: string;
  /** Minimum level to emit. Defaults to `info`. */
  level?: LogLevel;
  /** Fields attached to every line, including lines from `child()`. */
  bindings?: LogFields;
  /** Override the output. Defaults to one JSON object per line on stdout. */
  sink?: (line: string) => void;
  /** Clock override, so tests are deterministic. */
  now?: () => Date;
}

export interface Logger {
  readonly service: string;
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derives a logger with additional permanent fields, e.g. a taskId. */
  child(bindings: LogFields): Logger;
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Structured JSON logger (docs/planning/03 §5.12).
 *
 * Every field, including the bindings and anything inside an `Error`, passes
 * through the redaction deny-list before it is serialised. Emitting is
 * best-effort: a logger must never be the reason a request fails, so a value it
 * cannot serialise is reported rather than thrown.
 */
export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? writeToStdout;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  function emit(entryLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[entryLevel] < LEVEL_RANK[level]) {
      return;
    }

    // Metadata is spread last so a field named `level` or `msg` cannot spoof it.
    const record = redactValue({
      ...bindings,
      ...fields,
      time: now().toISOString(),
      level: entryLevel,
      service: options.service,
      msg: message,
    });

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        time: now().toISOString(),
        level: entryLevel,
        service: options.service,
        msg: message,
        logError: "unserialisable_fields",
      });
    }
    sink(line);
  }

  return {
    service: options.service,
    level,
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) =>
      createLogger({
        service: options.service,
        level,
        sink,
        now,
        bindings: { ...bindings, ...extra },
      }),
  };
}
