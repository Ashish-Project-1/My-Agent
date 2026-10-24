import { Injectable } from "@nestjs/common";
import type { ApprovalRequestSummary, ApprovalState } from "@ua/contracts";
import { forOrganization } from "@ua/database";
// Value import: Nest emits the constructor's token from runtime metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

/**
 * Approvals (docs/planning/06 §2.4, 07 §3.4).
 *
 * Reads go through `forOrganization`; the decision takes a transaction because
 * the row and its audit entry land together. `task_created_by` is copied onto
 * the request by the worker, so the inbox can answer "is this mine?" without
 * reading the tasks module (docs/planning/03 §4).
 */

const APPROVAL_SELECT = {
  id: true,
  task_id: true,
  step_id: true,
  tool_name: true,
  risk_class: true,
  summary: true,
  action_digest: true,
  policy_version: true,
  task_created_by: true,
  state: true,
  expires_at: true,
  decided_at: true,
  decided_by: true,
  created_at: true,
} as const;

type RawApproval = {
  id: string;
  task_id: string;
  step_id: string;
  tool_name: string;
  risk_class: string;
  summary: string;
  action_digest: string;
  policy_version: string;
  task_created_by: string | null;
  state: ApprovalState;
  expires_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  created_at: Date;
};

/** The wire shape plus the one field only authorization needs. */
export type ApprovalRecord = ApprovalRequestSummary & { taskCreatedByUserId: string | null };

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toRecord(row: RawApproval): ApprovalRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    toolName: row.tool_name,
    riskClass: row.risk_class as ApprovalRequestSummary["riskClass"],
    summary: row.summary,
    actionDigest: row.action_digest,
    policyVersion: row.policy_version,
    state: row.state,
    expiresAt: row.expires_at.toISOString(),
    decidedAt: iso(row.decided_at),
    decidedByUserId: row.decided_by,
    createdAt: row.created_at.toISOString(),
    taskCreatedByUserId: row.task_created_by,
  };
}

@Injectable()
export class ApprovalsRepository {
  constructor(private readonly database: UnscopedDatabase) {}

  transaction<T>(work: (writer: DbWriter) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(work);
  }

  async listApprovals(input: {
    organizationId: string;
    state?: ApprovalState | undefined;
    /** Non-admins see only requests for tasks they created. */
    requestedByUserId?: string | undefined;
  }): Promise<ApprovalRecord[]> {
    const db = forOrganization(this.database.client, input.organizationId);
    const rows = await db.approval_requests.findMany({
      where: {
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.requestedByUserId === undefined
          ? {}
          : { task_created_by: input.requestedByUserId }),
      },
      select: APPROVAL_SELECT,
      orderBy: { created_at: "desc" },
      take: 100,
    });
    return rows.map(toRecord);
  }

  async getApproval(organizationId: string, approvalId: string): Promise<ApprovalRecord | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.approval_requests.findFirst({
      where: { id: approvalId },
      select: APPROVAL_SELECT,
    });
    return row === null ? null : toRecord(row);
  }

  /**
   * Decide a pending request, atomically and only once (FR-APPR-03).
   *
   * The digest and the expiry are part of the `where`: a decision that names an
   * older action, arrives after expiry, or races a second decision changes no
   * row and returns null. That is what makes a grant single-use.
   */
  async decide(
    writer: DbWriter,
    input: {
      organizationId: string;
      approvalId: string;
      actionDigest: string;
      state: "granted" | "denied";
      decidedBy: string;
      note: string | null;
      now: Date;
    },
  ): Promise<ApprovalRecord | null> {
    const rows = await writer.approval_requests.updateManyAndReturn({
      where: {
        id: input.approvalId,
        organization_id: input.organizationId,
        state: "pending",
        action_digest: input.actionDigest,
        expires_at: { gt: input.now },
      },
      data: {
        state: input.state,
        decided_at: input.now,
        decided_by: input.decidedBy,
        decision_note: input.note,
      },
      select: APPROVAL_SELECT,
    });
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /** Expiry is a state, not a missing row: the inbox must still show it. */
  async markExpired(organizationId: string, approvalId: string, now: Date): Promise<void> {
    const db = forOrganization(this.database.client, organizationId);
    await db.approval_requests.updateMany({
      where: { id: approvalId, state: "pending" },
      data: { state: "expired", decided_at: now },
    });
  }
}
