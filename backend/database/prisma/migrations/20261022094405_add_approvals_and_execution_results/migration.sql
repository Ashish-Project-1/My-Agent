-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('pending', 'granted', 'denied', 'expired');

-- AlterTable
ALTER TABLE "device_commands" ADD COLUMN     "error" TEXT,
ADD COLUMN     "result" JSONB,
ADD COLUMN     "result_digest" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "workspace_id" UUID;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "risk_class" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "action_digest" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "task_created_by" UUID,
    "state" "ApprovalState" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "action_digest" TEXT NOT NULL,
    "risk_class" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "matched_rule" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "reasons" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_state_created_at_idx" ON "approval_requests"("organization_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_task_id_step_id_idx" ON "approval_requests"("task_id", "step_id");

-- CreateIndex
CREATE INDEX "approval_requests_expires_at_idx" ON "approval_requests"("expires_at");

-- CreateIndex
CREATE INDEX "policy_decisions_organization_id_created_at_idx" ON "policy_decisions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "policy_decisions_task_id_step_id_idx" ON "policy_decisions"("task_id", "step_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_idx" ON "tasks"("workspace_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
