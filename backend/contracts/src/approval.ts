import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";
import { RiskClass } from "./risk.js";
import { Sha256Hex } from "./tool.js";

/**
 * Approvals (docs/planning/07 §3.4, 10 §4, FR-APPR-01/03/04).
 *
 * A request is bound to one digest of one concrete action. It is decided once:
 * a grant cannot be widened, replayed against different arguments, or used
 * after expiry. The row is the whole authority — there is no separate grant
 * token to leak.
 */
export const APPROVAL_STATES = ["pending", "granted", "denied", "expired"] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const ApprovalState = z.enum(APPROVAL_STATES);

export const APPROVAL_SCOPES = ["once", "minutes", "task", "standing"] as const;

export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];
export const ApprovalScope = z.enum(APPROVAL_SCOPES);

export const ApprovalRequestSummary = z
  .object({
    id: Uuid,
    taskId: Uuid,
    stepId: Uuid,
    toolName: z.string().min(1),
    riskClass: RiskClass,
    summary: z.string().min(1).max(2000),
    /** The exact action, so the UI and the decision route agree on one value. */
    actionDigest: Sha256Hex,
    policyVersion: z.string().min(1),
    state: ApprovalState,
    expiresAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    decidedByUserId: Uuid.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type ApprovalRequestSummary = z.infer<typeof ApprovalRequestSummary>;

export const ApprovalListResponse = z
  .object({ approvals: z.array(ApprovalRequestSummary) })
  .strict();
export type ApprovalListResponse = z.infer<typeof ApprovalListResponse>;

export const ApprovalListQuery = z.object({ state: ApprovalState.optional() }).strict();
export type ApprovalListQuery = z.infer<typeof ApprovalListQuery>;

/**
 * `actionDigest` is required on a decision: a UI that showed an older action
 * cannot approve the newer one by id alone (FR-APPR-03). `scope` controls
 * how long a grant remains valid (docs/planning/10 §5.3).
 */
export const ApprovalDecisionRequest = z
  .object({
    actionDigest: Sha256Hex,
    note: z.string().trim().max(500).nullish(),
    scope: ApprovalScope.default("once"),
    /** Minutes for scope `minutes` (capped by policy). */
    minutes: z.number().int().min(1).max(60).nullish(),
  })
  .strict();
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;
