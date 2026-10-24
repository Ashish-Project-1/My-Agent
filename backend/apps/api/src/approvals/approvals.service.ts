import { Injectable } from "@nestjs/common";
import type {
  ApprovalDecisionRequest,
  ApprovalListQuery,
  ApprovalRequestSummary,
} from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import { AuditService } from "../audit/audit.service.js";
// Value imports for injected classes: Nest reads dependencies from decorator
// metadata, which a type-only import erases.
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import type { RequestMeta } from "../common/request-meta.js";
import { type ApprovalRecord, ApprovalsRepository } from "./approvals.repository.js";

/** Strip the authorization-only field: the wire contract is what the UI sees. */
function toSummary(record: ApprovalRecord): ApprovalRequestSummary {
  const { taskCreatedByUserId: _ignored, ...summary } = record;
  return summary;
}

/**
 * The approval inbox (docs/planning/07 §3.4, 10 §4, FR-APPR-01/03/04).
 *
 * A decision is who-may-act plus a digest check plus one atomic update. Every
 * one of those is required: without the digest a stale tab could approve a
 * different action, and without the compare-and-set two clicks would both
 * "win" a single-use grant.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly repository: ApprovalsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(principal: Principal, query: ApprovalListQuery): Promise<ApprovalRequestSummary[]> {
    const isAdmin = principal.role === "owner" || principal.role === "admin";
    const records = await this.repository.listApprovals({
      organizationId: principal.organizationId,
      state: query.state,
      requestedByUserId: isAdmin ? undefined : principal.userId,
    });
    return records.map(toSummary);
  }

  async get(principal: Principal, approvalId: string): Promise<ApprovalRequestSummary> {
    return toSummary(await this.requireVisible(principal, approvalId));
  }

  grant(
    principal: Principal,
    approvalId: string,
    input: ApprovalDecisionRequest,
    meta: RequestMeta,
  ): Promise<ApprovalRequestSummary> {
    return this.decide(principal, approvalId, input, "granted", meta);
  }

  deny(
    principal: Principal,
    approvalId: string,
    input: ApprovalDecisionRequest,
    meta: RequestMeta,
  ): Promise<ApprovalRequestSummary> {
    return this.decide(principal, approvalId, input, "denied", meta);
  }

  private async decide(
    principal: Principal,
    approvalId: string,
    input: ApprovalDecisionRequest,
    state: "granted" | "denied",
    meta: RequestMeta,
  ): Promise<ApprovalRequestSummary> {
    const approval = await this.requireVisible(principal, approvalId);
    const isAdmin = principal.role === "owner" || principal.role === "admin";
    if (!isAdmin && approval.taskCreatedByUserId !== principal.userId) {
      throw new AppError(
        "insufficient_role",
        "Only the task's creator or an admin can decide this.",
      );
    }
    if (approval.state !== "pending") {
      throw new AppError("state_conflict", "That approval has already been decided.");
    }

    const now = new Date();
    if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
      await this.repository.markExpired(principal.organizationId, approvalId, now);
      throw new AppError("approval_expired", "That approval expired before it was used.");
    }
    if (approval.actionDigest !== input.actionDigest) {
      throw new AppError(
        "state_conflict",
        "The action changed since this approval was shown; reload it before deciding.",
      );
    }

    return this.repository.transaction(async (writer) => {
      const decided = await this.repository.decide(writer, {
        organizationId: principal.organizationId,
        approvalId,
        actionDigest: input.actionDigest,
        state,
        decidedBy: principal.userId,
        note: input.note ?? null,
        now,
      });
      if (decided === null) {
        // Lost a race with another decision.
        throw new AppError("state_conflict", "That approval has already been decided.");
      }

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: state === "granted" ? AUDIT_ACTIONS.approvalGrant : AUDIT_ACTIONS.approvalDeny,
          resourceType: "approval",
          resourceId: approvalId,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: {
            task_id: approval.taskId,
            risk_class: approval.riskClass,
            action_digest: approval.actionDigest,
          },
        },
        writer,
      );

      return toSummary(decided);
    });
  }

  /** A request from another tenant, or another member's task, is `not_found`. */
  private async requireVisible(principal: Principal, approvalId: string): Promise<ApprovalRecord> {
    const approval = await this.repository.getApproval(principal.organizationId, approvalId);
    const isAdmin = principal.role === "owner" || principal.role === "admin";
    if (
      approval === null ||
      (!isAdmin &&
        approval.taskCreatedByUserId !== null &&
        approval.taskCreatedByUserId !== principal.userId)
    ) {
      throw new AppError("not_found", "That approval was not found.");
    }
    return approval;
  }
}
