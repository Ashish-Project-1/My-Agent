import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { type AgentSessionListResponse, type AgentSessionSummary, Uuid } from "@ua/contracts";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AgentSessionsService } from "./agent-sessions.service.js";

/**
 * The agent-session HTTP surface (docs/planning/07 §3.3).
 *
 * Tenant-scoped like tasks; a session in another tenant is 404.
 */
@Controller("v1/agent-sessions")
export class AgentSessionsController {
  constructor(private readonly sessions: AgentSessionsService) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<AgentSessionListResponse> {
    return { agent_sessions: await this.sessions.list(principal.organizationId) };
  }

  @Get(":sessionId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("sessionId", new ZodValidationPipe(Uuid)) sessionId: string,
  ): Promise<AgentSessionSummary> {
    const session = await this.sessions.get(principal.organizationId, sessionId);
    if (session === null) {
      throw new NotFoundException();
    }
    return session;
  }
}
