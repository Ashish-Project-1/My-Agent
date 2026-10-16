import { Global, Module } from "@nestjs/common";
import { loadConfig } from "./config.js";

/**
 * The token the validated configuration is injected by. It is a symbol rather
 * than a class so nothing can construct an unvalidated config by accident.
 */
export const CONFIG = Symbol("ua.config");

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
