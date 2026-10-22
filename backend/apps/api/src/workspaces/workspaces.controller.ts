import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  CreateWorkspaceGrantRequest,
  type RegisterWorkspaceRequest,
  RegisterWorkspaceRequest as RegisterWorkspaceRequestSchema,
  type UpdateWorkspaceRequest,
  UpdateWorkspaceRequest as UpdateWorkspaceRequestSchema,
  Uuid,
  type WorkspaceGrantListResponse,
  type WorkspaceGrantSummary,
  WorkspaceListQuery,
  type WorkspaceListResponse,
  type WorkspaceSummary,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { WorkspacesService } from "./workspaces.service.js";

/**
 * Workspaces and their grants, as the member sees them (FR-DEV-05, `12` §5.5).
 *
 * Registering a folder is what gives an agent somewhere to work, so every route
 * that changes one needs control of the device it sits on — the same rule as
 * commanding that device, and enforced in the service rather than repeated here.
 */
@Controller("v1/workspaces")
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(201)
  async register(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(RegisterWorkspaceRequestSchema)) body: RegisterWorkspaceRequest,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.register(principal, body, requestMeta(request, this.config));
  }

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(WorkspaceListQuery)) query: WorkspaceListQuery,
  ): Promise<WorkspaceListResponse> {
    return {
      workspaces: await this.workspaces.list(principal.organizationId, query.deviceId),
    };
  }

  @Get(":workspaceId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("workspaceId", new ZodValidationPipe(Uuid)) workspaceId: string,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.get(principal.organizationId, workspaceId);
  }

  @Patch(":workspaceId")
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param("workspaceId", new ZodValidationPipe(Uuid)) workspaceId: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceRequestSchema)) body: UpdateWorkspaceRequest,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.update(principal, workspaceId, body, requestMeta(request, this.config));
  }

  @Delete(":workspaceId")
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param("workspaceId", new ZodValidationPipe(Uuid)) workspaceId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.workspaces.remove(principal, workspaceId, requestMeta(request, this.config));
  }

  @Get(":workspaceId/grants")
  async listGrants(
    @CurrentPrincipal() principal: Principal,
    @Param("workspaceId", new ZodValidationPipe(Uuid)) workspaceId: string,
  ): Promise<WorkspaceGrantListResponse> {
    return { grants: await this.workspaces.listGrants(principal.organizationId, workspaceId) };
  }

  @Post(":workspaceId/grants")
  @HttpCode(201)
  async createGrant(
    @CurrentPrincipal() principal: Principal,
    @Param("workspaceId", new ZodValidationPipe(Uuid)) workspaceId: string,
    @Body(new ZodValidationPipe(CreateWorkspaceGrantRequest)) body: CreateWorkspaceGrantRequest,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceGrantSummary> {
    return this.workspaces.createGrant(
      principal,
      workspaceId,
      body,
      requestMeta(request, this.config),
    );
  }
}
