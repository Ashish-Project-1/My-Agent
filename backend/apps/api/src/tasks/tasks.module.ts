import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DevicesModule } from "../devices/devices.module.js";
import { WorkspacesModule } from "../workspaces/workspaces.module.js";
import { TaskEventsStreamController } from "./task-events.stream.controller.js";
import { TaskEventsStreamService } from "./task-events.stream.js";
import { TasksController } from "./tasks.controller.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

@Module({
  // Device and workspace ownership are their modules' answers (docs/planning/03 §4).
  imports: [AuditModule, DevicesModule, WorkspacesModule],
  providers: [TasksRepository, TasksService, TaskEventsStreamService],
  controllers: [TasksController, TaskEventsStreamController],
})
export class TasksModule {}
