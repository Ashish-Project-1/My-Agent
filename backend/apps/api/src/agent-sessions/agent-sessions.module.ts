import { Module } from "@nestjs/common";
import { AgentSessionsController } from "./agent-sessions.controller.js";
import { AgentSessionsRepository } from "./agent-sessions.repository.js";
import { AgentSessionsService } from "./agent-sessions.service.js";

@Module({
  providers: [AgentSessionsRepository, AgentSessionsService],
  controllers: [AgentSessionsController],
})
export class AgentSessionsModule {}
