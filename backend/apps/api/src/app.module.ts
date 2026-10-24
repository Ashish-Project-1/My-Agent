import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AgentSessionsModule } from "./agent-sessions/agent-sessions.module.js";
import { ApprovalsModule } from "./approvals/approvals.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthGuard } from "./common/auth.guard.js";
import { ConfigModule } from "./config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DevicesModule } from "./devices/devices.module.js";
import { HealthController } from "./health/health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import { LoggingModule } from "./logging.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { PolicyModule } from "./policy/policy.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";

/**
 * The root module: wires everything, exports nothing and registers a single
 * global guard that denies by default (docs/planning/11 §5).
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    IdentityModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    TasksModule,
    AgentSessionsModule,
    DevicesModule,
    WorkspacesModule,
    ApprovalsModule,
    PolicyModule,
  ],
  controllers: [HealthController],
  providers: [
    AuthGuard,
    {
      provide: APP_GUARD,
      useExisting: AuthGuard,
    },
  ],
})
export class AppModule {}
