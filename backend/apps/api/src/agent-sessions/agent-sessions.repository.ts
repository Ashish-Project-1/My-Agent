import { Injectable } from "@nestjs/common";
import type { AgentSessionSummary } from "@ua/contracts";
import { forOrganization } from "@ua/database";
// Value import: Nest emits the constructor's token from runtime metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";

/** An agent session as the API exposes it (docs/planning/06 §2.3). */
export type AgentSessionRow = AgentSessionSummary;

const SESSION_SELECT = {
  id: true,
  title: true,
  execution_location: true,
  created_at: true,
  archived_at: true,
} as const;

type RawSession = {
  id: string;
  title: string | null;
  execution_location: AgentSessionSummary["executionLocation"];
  created_at: Date;
  archived_at: Date | null;
};

const toSessionRow = (row: RawSession): AgentSessionRow => ({
  id: row.id,
  title: row.title,
  executionLocation: row.execution_location,
  createdAt: row.created_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});

/**
 * The agent-session reads (docs/planning/06 §2.3).
 *
 * Reached only through `forOrganization`, so every read carries the caller's
 * tenant filter (ADR-008).
 */
@Injectable()
export class AgentSessionsRepository {
  constructor(private readonly database: UnscopedDatabase) {}

  async listSessions(organizationId: string): Promise<AgentSessionRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.agent_sessions.findMany({
      select: SESSION_SELECT,
      orderBy: { created_at: "desc" },
      take: 50,
    });
    return rows.map(toSessionRow);
  }

  async getSession(organizationId: string, sessionId: string): Promise<AgentSessionRow | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.agent_sessions.findFirst({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
    return row === null ? null : toSessionRow(row);
  }
}
