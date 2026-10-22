-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('QUEUED', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_DEVICE', 'PAUSED', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaskStepKind" AS ENUM ('model', 'tool', 'approval', 'verify');

-- CreateEnum
CREATE TYPE "TaskStepState" AS ENUM ('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskEventActor" AS ENUM ('user', 'device', 'worker', 'system');

-- CreateEnum
CREATE TYPE "ExecutionLocation" AS ENUM ('device', 'cloud');

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "execution_location" "ExecutionLocation" NOT NULL DEFAULT 'cloud',
    "model_config" JSONB,
    "token_usage" INTEGER DEFAULT -1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "agent_session_id" UUID NOT NULL,
    "created_by" UUID,
    "device_id" UUID,
    "goal" TEXT NOT NULL,
    "constraints" JSONB,
    "execution_location" "ExecutionLocation" NOT NULL DEFAULT 'cloud',
    "state" "TaskState" NOT NULL DEFAULT 'QUEUED',
    "state_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "risk_class" TEXT,
    "plan" JSONB,
    "policy_version" TEXT,
    "budget_used" JSONB,
    "result_summary" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "idempotency_key_id" UUID,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_steps" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "TaskStepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "tool_name" TEXT,
    "tool_version" TEXT,
    "arguments" JSONB,
    "arguments_digest" TEXT,
    "risk_class" TEXT,
    "state" "TaskStepState" NOT NULL DEFAULT 'PENDING',
    "depends_on" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ,
    "heartbeat_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "result" JSONB,
    "result_digest" TEXT,
    "error_code" TEXT,
    "idempotency_key" TEXT,
    "cost_minor" BIGINT DEFAULT 0,
    "tokens" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "task_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "actor" "TaskEventActor" NOT NULL DEFAULT 'system',
    "actor_id" UUID,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checkpoints" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_seq" INTEGER NOT NULL,
    "state_blob_enc" TEXT,
    "workspace_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" BIGSERIAL NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_leases" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "lease_id" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeat_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_organization_id_created_at_idx" ON "agent_sessions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_created_at_idx" ON "agent_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_created_at_idx" ON "tasks"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_state_created_at_idx" ON "tasks"("organization_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "tasks_agent_session_id_created_at_idx" ON "tasks"("agent_session_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_lease_owner_idx" ON "tasks"("lease_owner");

-- CreateIndex
CREATE INDEX "tasks_lease_expires_at_idx" ON "tasks"("lease_expires_at");

-- CreateIndex
CREATE INDEX "task_steps_organization_id_created_at_idx" ON "task_steps"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "task_steps_task_id_state_idx" ON "task_steps"("task_id", "state");

-- CreateIndex
CREATE INDEX "task_steps_lease_owner_idx" ON "task_steps"("lease_owner");

-- CreateIndex
CREATE INDEX "task_steps_lease_expires_at_idx" ON "task_steps"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_steps_task_id_seq_key" ON "task_steps"("task_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "task_steps_task_id_idempotency_key_key" ON "task_steps"("task_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "task_events_organization_id_created_at_idx" ON "task_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "task_events_task_id_seq_idx" ON "task_events"("task_id", "seq");

-- CreateIndex
CREATE INDEX "task_events_type_created_at_idx" ON "task_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_events_task_id_seq_key" ON "task_events"("task_id", "seq");

-- CreateIndex
CREATE INDEX "task_checkpoints_organization_id_created_at_idx" ON "task_checkpoints"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "task_checkpoints_task_id_step_seq_created_at_idx" ON "task_checkpoints"("task_id", "step_seq", "created_at");

-- CreateIndex
CREATE INDEX "outbox_processed_at_available_at_idx" ON "outbox"("processed_at", "available_at");

-- CreateIndex
CREATE INDEX "outbox_organization_id_created_at_idx" ON "outbox"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "job_leases_expires_at_idx" ON "job_leases"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_leases_resource_type_resource_id_key" ON "job_leases"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checkpoints" ADD CONSTRAINT "task_checkpoints_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checkpoints" ADD CONSTRAINT "task_checkpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
