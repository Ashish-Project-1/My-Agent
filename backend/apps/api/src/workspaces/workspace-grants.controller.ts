import { Controller, Delete, HttpCode, Inject, Param, Req } from "@nestjs/common";
import { Uuid } from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { WorkspacesService } from "./workspaces.service.js";

/**
 * Standing grants, revoked from where they are listed (docs/planning/07 §3.6).
 *
 * A grant is revoked by its own id rather than under its workspace, because the
 * person doing it is looking at a list of rules and not at a directory.
 */
@Controller("v1/grants")
export class WorkspaceGrantsController {
  constructor(
    private readonly workspaces: WorkspacesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Delete(":grantId")
  @HttpCode(204)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param("grantId", new ZodValidationPipe(Uuid)) grantId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.workspaces.revokeGrant(principal, grantId, requestMeta(request, this.config));
  }
}
