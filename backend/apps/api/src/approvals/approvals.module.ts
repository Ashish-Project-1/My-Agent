import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ApprovalsController } from "./approvals.controller.js";
import { ApprovalsRepository } from "./approvals.repository.js";
import { ApprovalsService } from "./approvals.service.js";

/**
 * Approvals own `approval_requests` and `policy_decisions` (docs/planning/03 §4).
 *
 * The worker writes both; this module reads the inbox and writes the decision.
 * They live together because "why was this allowed?" and "who approved it?" are
 * one question about one row.
 */
@Module({
  imports: [AuditModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsRepository, ApprovalsService],
})
export class ApprovalsModule {}
