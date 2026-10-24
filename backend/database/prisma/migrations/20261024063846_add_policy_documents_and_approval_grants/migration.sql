-- CreateTable
CREATE TABLE "approval_grants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "request_id" UUID,
    "grant_token_hash" TEXT NOT NULL,
    "action_digest" TEXT NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "target_digest" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "policy_version" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "approval_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_grants_grant_token_hash_key" ON "approval_grants"("grant_token_hash");

-- CreateIndex
CREATE INDEX "approval_grants_organization_id_expires_at_idx" ON "approval_grants"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "approval_grants_request_id_idx" ON "approval_grants"("request_id");

-- AddForeignKey
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
