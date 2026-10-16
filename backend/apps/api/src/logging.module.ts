import { Global, Module } from "@nestjs/common";
import { createLogger } from "@ua/logger";
import type { AppConfig } from "./config.js";
import { CONFIG } from "./config.module.js";

/** The platform logger (docs/planning/03 §5.12) — never Nest's own logger. */
export const LOGGER = Symbol("ua.logger");

@Global()
@Module({
  providers: [
    {
      provide: LOGGER,
      useFactory: (config: AppConfig) => createLogger({ service: "api", level: config.logLevel }),
      inject: [CONFIG],
    },
  ],
  exports: [LOGGER],
})
export class LoggingModule {}
