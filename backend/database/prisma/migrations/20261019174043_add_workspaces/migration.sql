-- CreateEnum
CREATE TYPE "WorkspaceMode" AS ENUM ('read_only', 'read_write');

-- CreateEnum
CREATE TYPE "WorkspaceGrantEffect" AS ENUM ('allow', 'deny');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "raw_path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "WorkspaceMode" NOT NULL DEFAULT 'read_write',
    "created_by" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_grants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "path_pattern" TEXT NOT NULL,
    "effect" "WorkspaceGrantEffect" NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspaces_organization_id_created_at_idx" ON "workspaces"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "workspaces_device_id_idx" ON "workspaces"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_device_id_path_key" ON "workspaces"("device_id", "path");

-- CreateIndex
CREATE INDEX "workspace_grants_organization_id_created_at_idx" ON "workspace_grants"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_grants_workspace_id_effect_idx" ON "workspace_grants"("workspace_id", "effect");

-- CreateIndex
CREATE INDEX "workspace_grants_expires_at_idx" ON "workspace_grants"("expires_at");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
