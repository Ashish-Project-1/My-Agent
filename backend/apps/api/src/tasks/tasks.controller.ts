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
  CreateTaskRequest,
  type TaskEventListResponse,
  type TaskListResponse,
  type TaskStepListResponse,
  type TaskSummary,
  Uuid,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { TasksService } from "./tasks.service.js";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/**
 * The task HTTP surface (docs/planning/07 §3.3).
 *
 * Every route is tenant-scoped by the session's active organization; a task in
 * another tenant resolves to 404 rather than 403 so its existence is not
 * disclosed (docs/planning/06 §5).
 */
@Controller("v1/tasks")
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateTaskRequest)) body: CreateTaskRequest,
    @Req() request: FastifyRequest,
  ): Promise<TaskSummary> {
    const meta = requestMeta(request, this.config);
    const header = request.headers[IDEMPOTENCY_KEY_HEADER];
    const idempotencyKey = typeof header === "string" && header.length > 0 ? header : null;
    return this.tasks.create(principal, body, meta, idempotencyKey);
  }

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<TaskListResponse> {
    return { tasks: await this.tasks.list(principal.organizationId) };
  }

  @Get(":taskId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("taskId", new ZodValidationPipe(Uuid)) taskId: string,
  ): Promise<TaskSummary> {
    const task = await this.tasks.get(principal.organizationId, taskId);
    if (task === null) {
      throw new NotFoundException();
    }
    return task;
  }

  @Get(":taskId/events")
  async events(
    @CurrentPrincipal() principal: Principal,
    @Param("taskId", new ZodValidationPipe(Uuid)) taskId: string,
  ): Promise<TaskEventListResponse> {
    return { events: await this.tasks.events(principal.organizationId, taskId) };
  }

  @Get(":taskId/steps")
  async steps(
    @CurrentPrincipal() principal: Principal,
    @Param("taskId", new ZodValidationPipe(Uuid)) taskId: string,
  ): Promise<TaskStepListResponse> {
    return { steps: await this.tasks.steps(principal.organizationId, taskId) };
  }
}
