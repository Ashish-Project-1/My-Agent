import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DevicesModule } from "../devices/devices.module.js";
import { DeviceWorkspacesController } from "./device-workspaces.controller.js";
import { WorkspaceGrantsController } from "./workspace-grants.controller.js";
import { WorkspacesController } from "./workspaces.controller.js";
import { WorkspacesRepository } from "./workspaces.repository.js";
import { WorkspacesService } from "./workspaces.service.js";

/**
 * Workspaces own `workspaces` and `workspace_grants` (docs/planning/03 §4).
 *
 * `DevicesModule` is imported rather than `devices` queried: which member may
 * change a machine's roots is the devices module's answer, and asking it is what
 * keeps that one rule in one place.
 */
@Module({
  imports: [AuditModule, DevicesModule],
  controllers: [WorkspacesController, WorkspaceGrantsController, DeviceWorkspacesController],
  providers: [WorkspacesRepository, WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
