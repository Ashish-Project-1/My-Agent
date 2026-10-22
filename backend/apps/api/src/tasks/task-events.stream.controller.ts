import { Controller, Get, Headers, NotFoundException, Param, Req, Res } from "@nestjs/common";
import { Uuid } from "@ua/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sseResync } from "./sse-frames.js";
import { TaskEventsStreamService } from "./task-events.stream.js";
import { TasksRepository } from "./tasks.repository.js";

/**
 * `GET /v1/tasks/{taskId}/stream` — the SSE task-progress stream
 * (docs/planning/07 §5).
 *
 * Auth is the session cookie, which `EventSource` sends for a same-origin
 * request. A 404 is raised before the response is hijacked, so it is still a
 * normal `application/problem+json` body; once streaming starts the only error
 * signal is `event: resync`, which tells the client to refetch task state.
 */
@Controller("v1/tasks")
export class TaskEventsStreamController {
  constructor(
    private readonly repository: TasksRepository,
    private readonly stream: TaskEventsStreamService,
  ) {}

  @Get(":taskId/stream")
  async streamTaskEvents(
    @CurrentPrincipal() principal: Principal,
    @Param("taskId", new ZodValidationPipe(Uuid)) taskId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const task = await this.repository.getTask(principal.organizationId, taskId);
    if (task === null) {
      throw new NotFoundException();
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Defeats buffering reverse proxies (nginx); the client sees frames promptly.
      "x-accel-buffering": "no",
    });

    const abort = new AbortController();
    const onClose = (): void => abort.abort();
    request.raw.on("close", onClose);

    try {
      for await (const frame of this.stream.stream({
        organizationId: principal.organizationId,
        taskId,
        lastEventId,
        signal: abort.signal,
      })) {
        res.write(frame);
      }
    } catch {
      // A failure mid-stream cannot be a status code; tell the client to resync.
      res.write(sseResync());
    } finally {
      request.raw.off("close", onClose);
      res.end();
    }
  }
}
