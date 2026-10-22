import { Injectable } from "@nestjs/common";
import { AgentSessionsRepository } from "./agent-sessions.repository.js";

/**
 * Agent sessions (docs/planning/06 §2.3).
 *
 * Phase 3 slice: list and fetch one. Creation lands with the task workspace.
 */
@Injectable()
export class AgentSessionsService {
  constructor(private readonly repository: AgentSessionsRepository) {}

  list(organizationId: string) {
    return this.repository.listSessions(organizationId);
  }

  get(organizationId: string, sessionId: string) {
    return this.repository.getSession(organizationId, sessionId);
  }
}
