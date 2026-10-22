import { Injectable } from "@nestjs/common";
import type { TaskEventSummary, TaskStepSummary, TaskSummary } from "@ua/contracts";
import { forOrganization } from "@ua/database";
// Value import: Nest emits the constructor's token from runtime metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

/** A task as the API exposes it (docs/planning/06 §2.3). */
export type TaskRow = TaskSummary;
export type TaskStepRow = TaskStepSummary;
export type TaskEventRow = TaskEventSummary;

const TASK_SELECT = {
  id: true,
  agent_session_id: true,
  goal: true,
  state: true,
  execution_location: true,
  risk_class: true,
  result_summary: true,
  error_code: true,
  attempts: true,
  created_at: true,
  started_at: true,
  finished_at: true,
} as const;

type RawTask = {
  id: string;
  agent_session_id: string;
  goal: string;
  state: TaskSummary["state"];
  execution_location: TaskSummary["executionLocation"];
  risk_class: string | null;
  result_summary: string | null;
  error_code: string | null;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const toTaskRow = (row: RawTask): TaskRow => ({
  id: row.id,
  agentSessionId: row.agent_session_id,
  goal: row.goal,
  state: row.state,
  executionLocation: row.execution_location,
  riskClass: row.risk_class,
  resultSummary: row.result_summary,
  errorCode: row.error_code,
  attempts: row.attempts,
  createdAt: row.created_at.toISOString(),
  startedAt: iso(row.started_at),
  finishedAt: iso(row.finished_at),
});

/**
 * The task reads (docs/planning/06 §2.3).
 *
 * Tenant rows are reached only through `forOrganization`, so a read cannot
 * forget the `organization_id` filter (ADR-008). Rows are mapped to the wire
 * contracts so no Prisma enum or `Date` leaks into the API's public types.
 */
@Injectable()
export class TasksRepository {
  constructor(private readonly database: UnscopedDatabase) {}

  async listTasks(organizationId: string): Promise<TaskRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.tasks.findMany({
      select: TASK_SELECT,
      orderBy: { created_at: "desc" },
      take: 50,
    });
    return rows.map(toTaskRow);
  }

  async getTask(organizationId: string, taskId: string): Promise<TaskRow | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.tasks.findFirst({ where: { id: taskId }, select: TASK_SELECT });
    return row === null ? null : toTaskRow(row);
  }

  async listTaskEvents(organizationId: string, taskId: string): Promise<TaskEventRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.task_events.findMany({
      where: { task_id: taskId },
      select: { seq: true, type: true, actor: true, data: true, created_at: true },
      orderBy: { seq: "asc" },
    });
    return rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      actor: row.actor,
      data: row.data,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /**
   * List events after a given sequence number for SSE resume.
   * `afterSeq` should be the last received seq; we return seq > afterSeq.
   */
  async listTaskEventsAfter(
    organizationId: string,
    taskId: string,
    afterSeq: number,
  ): Promise<TaskEventRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.task_events.findMany({
      where: { task_id: taskId, seq: { gt: afterSeq } },
      select: { seq: true, type: true, actor: true, data: true, created_at: true },
      orderBy: { seq: "asc" },
    });
    return rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      actor: row.actor,
      data: row.data,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async listTaskSteps(organizationId: string, taskId: string): Promise<TaskStepRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.task_steps.findMany({
      where: { task_id: taskId },
      select: {
        id: true,
        seq: true,
        kind: true,
        title: true,
        tool_name: true,
        state: true,
        risk_class: true,
        attempts: true,
        started_at: true,
        finished_at: true,
      },
      orderBy: { seq: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      title: row.title,
      toolName: row.tool_name,
      state: row.state,
      riskClass: row.risk_class,
      attempts: row.attempts,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
    }));
  }

  /**
   * One unit of work for a creation path: every row lands together or none does
   * (docs/planning/06 §7 — task + event + outbox + idempotency are one
   * transaction).
   *
   * The transaction is deliberately unscoped: a task and its event, outbox row
   * and idempotency key must be created atomically, and `forOrganization` cannot
   * wrap a transaction client. Every write below binds `organization_id` to the
   * authenticated caller's org, which is never taken from the request body, so a
   * cross-tenant row is not reachable through this path.
   */
  transaction<T>(work: (writer: DbWriter) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(work);
  }

  async createAgentSession(
    writer: DbWriter,
    input: { organizationId: string; userId: string; title: string | null },
  ): Promise<string> {
    const row = await writer.agent_sessions.create({
      data: {
        organization_id: input.organizationId,
        user_id: input.userId,
        title: input.title,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** False when the session is missing or belongs to another tenant. */
  async agentSessionInOrg(
    writer: DbWriter,
    organizationId: string,
    sessionId: string,
  ): Promise<boolean> {
    const row = await writer.agent_sessions.findFirst({
      where: { id: sessionId, organization_id: organizationId },
      select: { id: true },
    });
    return row !== null;
  }

  async createTask(
    writer: DbWriter,
    input: { organizationId: string; agentSessionId: string; createdBy: string; goal: string },
  ): Promise<TaskRow> {
    const row = await writer.tasks.create({
      data: {
        organization_id: input.organizationId,
        agent_session_id: input.agentSessionId,
        created_by: input.createdBy,
        goal: input.goal,
        state: "QUEUED",
      },
      select: TASK_SELECT,
    });
    return toTaskRow(row);
  }

  async appendTaskEvent(
    writer: DbWriter,
    input: {
      organizationId: string;
      taskId: string;
      seq: number;
      type: string;
      actor: TaskEventSummary["actor"];
      actorId: string | null;
    },
  ): Promise<void> {
    await writer.task_events.create({
      data: {
        organization_id: input.organizationId,
        task_id: input.taskId,
        seq: input.seq,
        type: input.type,
        actor: input.actor,
        actor_id: input.actorId,
      },
    });
  }

  async publishOutbox(
    writer: DbWriter,
    input: {
      organizationId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, string>;
    },
  ): Promise<void> {
    await writer.outbox.create({
      data: {
        organization_id: input.organizationId,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        event_type: input.eventType,
        payload: input.payload,
      },
    });
  }

  async findIdempotencyRecord(
    writer: DbWriter,
    input: { organizationId: string; scope: string; key: string },
  ) {
    return writer.idempotency_keys.findUnique({
      where: {
        organization_id_scope_key: {
          organization_id: input.organizationId,
          scope: input.scope,
          key: input.key,
        },
      },
    });
  }

  async insertIdempotencyRecord(
    writer: DbWriter,
    input: {
      organizationId: string;
      scope: string;
      key: string;
      requestDigest: string;
      expiresAt: Date;
    },
  ): Promise<string> {
    const row = await writer.idempotency_keys.create({
      data: {
        organization_id: input.organizationId,
        scope: input.scope,
        key: input.key,
        request_digest: input.requestDigest,
        state: "in_progress",
        expires_at: input.expiresAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  async completeIdempotencyRecord(
    writer: DbWriter,
    input: { id: string; responseStatus: number; responseBody: TaskSummary },
  ): Promise<void> {
    await writer.idempotency_keys.update({
      where: { id: input.id },
      data: {
        state: "completed",
        response_status: input.responseStatus,
        response_body: input.responseBody,
      },
    });
  }
}
