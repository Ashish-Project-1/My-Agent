import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  CreateOrganizationRequest,
  type OrganizationListResponse,
  type OrganizationSummary,
  Uuid,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
// Value import: Nest reads the injected token from decorator metadata.
import { OrganizationsService } from "./organizations.service.js";

/**
 * Organizations HTTP surface (docs/planning/07 §3.2).
 *
 * Only the slice required for Phase 2 is implemented: list, create and fetch one
 * membership. The resource lookup uses 404 when the caller is not a member, so a
 * foreign organization cannot be confirmed to exist.
 */
@Controller("v1/organizations")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<OrganizationListResponse> {
    return this.organizations.list(principal);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateOrganizationRequest)) body: CreateOrganizationRequest,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationSummary> {
    const meta = requestMeta(request, this.config);
    return this.organizations.create(principal, body, meta);
  }

  @Get(":orgId")
  async getOne(
    @CurrentPrincipal() principal: Principal,
    @Param("orgId", new ZodValidationPipe(Uuid)) orgId: string,
  ): Promise<OrganizationSummary> {
    const membership = await this.organizations.findForMember(principal, orgId);
    if (membership === null) {
      throw new NotFoundException();
    }
    return membership;
  }
}
