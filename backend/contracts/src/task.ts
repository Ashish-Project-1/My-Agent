import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";

/**
 * Task lifecycle states (docs/planning/08 §4). The transition table itself lives
 * with the engine — a contract must never become a second authority on which
 * transitions are legal.
 */
export const TASK_STATES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_DEVICE",
  "PAUSED",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export const TaskState = z.enum(TASK_STATES);

/**
 * Terminal states are final: a retry creates a new task linked by `retryOf`,
 * it never revives the old one (docs/planning/08 §4.2).
 */
export const TERMINAL_TASK_STATES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly TaskState[];

export function isTerminalTaskState(state: TaskState): boolean {
  return (TERMINAL_TASK_STATES as readonly string[]).includes(state);
}

/** Step kinds (docs/planning/08 §2.2). */
export const STEP_KINDS = ["model", "tool", "approval", "verify"] as const;

export type StepKind = (typeof STEP_KINDS)[number];
export const StepKind = z.enum(STEP_KINDS);

/** Where work runs, and therefore whose machine holds the data (docs/planning/08 §2.1). */
export const EXECUTION_LOCATIONS = ["device", "cloud"] as const;

export type ExecutionLocation = (typeof EXECUTION_LOCATIONS)[number];
export const ExecutionLocation = z.enum(EXECUTION_LOCATIONS);

/** Per-step lifecycle states (docs/planning/06 §2.3). */
export const TASK_STEP_STATES = [
  "PENDING",
  "RUNNING",
  "WAITING_APPROVAL",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;
export type TaskStepState = (typeof TASK_STEP_STATES)[number];
export const TaskStepState = z.enum(TASK_STEP_STATES);

/** Who caused an event (docs/planning/06 §2.3). */
export const TASK_EVENT_ACTORS = ["user", "device", "worker", "system"] as const;
export type TaskEventActor = (typeof TASK_EVENT_ACTORS)[number];
export const TaskEventActor = z.enum(TASK_EVENT_ACTORS);

/** The task-creation body (docs/planning/07 §3.3, FR-TASK-01/10). */
export const GOAL_MAX_LENGTH = 4000;

export const CreateTaskRequest = z
  .object({
    goal: z.string().trim().min(1, "is required").max(GOAL_MAX_LENGTH),
    /**
     * The session this task belongs to. Omitted or null lets the server open a
     * new agent session in the same transaction, so a client can create a task
     * without first creating a session.
     */
    agentSessionId: Uuid.nullish(),
    /**
     * Run on a paired device, inside one of its registered workspaces
     * (docs/planning/17 Phase 5, M0). Both are required together and are
     * checked in the service; the pair is what makes the task device-located.
     */
    deviceId: Uuid.nullish(),
    workspaceId: Uuid.nullish(),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const TaskSummary = z
  .object({
    id: Uuid,
    agentSessionId: Uuid,
    goal: z.string(),
    state: TaskState,
    executionLocation: ExecutionLocation,
    deviceId: Uuid.nullable(),
    workspaceId: Uuid.nullable(),
    riskClass: z.string().nullable(),
    resultSummary: z.string().nullable(),
    errorCode: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    createdAt: Timestamp,
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
  })
  .strict();
export type TaskSummary = z.infer<typeof TaskSummary>;

export const TaskListResponse = z.object({ tasks: z.array(TaskSummary) }).strict();
export type TaskListResponse = z.infer<typeof TaskListResponse>;

export const TaskStepSummary = z
  .object({
    id: Uuid,
    seq: z.number().int().nonnegative(),
    kind: StepKind,
    title: z.string(),
    toolName: z.string().nullable(),
    state: TaskStepState,
    riskClass: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
  })
  .strict();
export type TaskStepSummary = z.infer<typeof TaskStepSummary>;

export const TaskStepListResponse = z.object({ steps: z.array(TaskStepSummary) }).strict();
export type TaskStepListResponse = z.infer<typeof TaskStepListResponse>;

/**
 * One append-only event. `data` is redacted and size-capped before it is stored
 * (docs/planning/06 §6), so the contract can only promise "a JSON value".
 */
export const TaskEventSummary = z
  .object({
    seq: z.number().int().nonnegative(),
    type: z.string(),
    actor: TaskEventActor,
    data: z.unknown().nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type TaskEventSummary = z.infer<typeof TaskEventSummary>;

export const TaskEventListResponse = z.object({ events: z.array(TaskEventSummary) }).strict();
export type TaskEventListResponse = z.infer<typeof TaskEventListResponse>;

export const AgentSessionSummary = z
  .object({
    id: Uuid,
    title: z.string().nullable(),
    executionLocation: ExecutionLocation,
    createdAt: Timestamp,
    archivedAt: Timestamp.nullable(),
  })
  .strict();
export type AgentSessionSummary = z.infer<typeof AgentSessionSummary>;

export const AgentSessionListResponse = z
  .object({ agent_sessions: z.array(AgentSessionSummary) })
  .strict();
export type AgentSessionListResponse = z.infer<typeof AgentSessionListResponse>;
