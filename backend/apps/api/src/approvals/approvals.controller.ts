import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  ApprovalDecisionRequest,
  type ApprovalListQuery,
  ApprovalListQuery as ApprovalListQuerySchema,
  type ApprovalListResponse,
  type ApprovalRequestSummary,
  Uuid,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { ApprovalsService } from "./approvals.service.js";

/**
 * The approval inbox (docs/planning/07 §3.4, FR-APPR-01).
 *
 * `grant` and `deny` are separate routes because they are separate audit acts,
 * and both carry the digest the caller was shown — a decision names the action,
 * not just the row.
 */
@Controller("v1/approvals")
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(ApprovalListQuerySchema)) query: ApprovalListQuery,
  ): Promise<ApprovalListResponse> {
    return { approvals: await this.approvals.list(principal, query) };
  }

  @Get(":approvalId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("approvalId", new ZodValidationPipe(Uuid)) approvalId: string,
  ): Promise<ApprovalRequestSummary> {
    return this.approvals.get(principal, approvalId);
  }

  @Post(":approvalId/grant")
  @HttpCode(200)
  async grant(
    @CurrentPrincipal() principal: Principal,
    @Param("approvalId", new ZodValidationPipe(Uuid)) approvalId: string,
    @Body(new ZodValidationPipe(ApprovalDecisionRequest)) body: ApprovalDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<ApprovalRequestSummary> {
    return this.approvals.grant(principal, approvalId, body, requestMeta(request, this.config));
  }

  @Post(":approvalId/deny")
  @HttpCode(200)
  async deny(
    @CurrentPrincipal() principal: Principal,
    @Param("approvalId", new ZodValidationPipe(Uuid)) approvalId: string,
    @Body(new ZodValidationPipe(ApprovalDecisionRequest)) body: ApprovalDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<ApprovalRequestSummary> {
    return this.approvals.deny(principal, approvalId, body, requestMeta(request, this.config));
  }
}
