import { z } from "zod";
import { Uuid } from "./common.js";

export const QueueJobType = z.enum(["task.plan", "task.step.execute", "task.verify"]);
export type QueueJobType = z.infer<typeof QueueJobType>;

export const TaskPlanJobPayload = z
  .object({
    organizationId: Uuid,
    taskId: Uuid,
    attempt: z.number().int().min(0),
    traceId: z.string().nullish(),
    schemaVersion: z.number().int().min(1).default(1),
  })
  .strict();
export type TaskPlanJobPayload = z.infer<typeof TaskPlanJobPayload>;

export const TaskStepExecuteJobPayload = z
  .object({
    organizationId: Uuid,
    taskId: Uuid,
    stepId: Uuid,
    seq: z.number().int().min(0),
    executionLocation: z.string(),
    deviceId: Uuid.nullish(),
    leaseId: Uuid.nullish(),
    attempt: z.number().int().min(0),
    traceId: z.string().nullish(),
    schemaVersion: z.number().int().min(1).default(1),
  })
  .strict();
export type TaskStepExecuteJobPayload = z.infer<typeof TaskStepExecuteJobPayload>;

export const TaskVerifyJobPayload = z
  .object({
    organizationId: Uuid,
    taskId: Uuid,
    stepId: Uuid.nullish(),
    assertions: z.array(z.unknown()).default([]),
    traceId: z.string().nullish(),
    schemaVersion: z.number().int().min(1).default(1),
  })
  .strict();
export type TaskVerifyJobPayload = z.infer<typeof TaskVerifyJobPayload>;
