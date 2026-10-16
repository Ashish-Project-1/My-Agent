import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";

/** Auth API surface. */
@Module({
  imports: [IdentityModule, AuditModule],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
