-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('pending', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "DeviceCommandState" AS ENUM ('pending', 'sent', 'acked', 'expired');

-- CreateEnum
CREATE TYPE "DeviceCommandKind" AS ENUM ('diagnostics_ping');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "os_version" TEXT,
    "runner_version" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "key_algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "fingerprint" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'pending',
    "capabilities" JSONB,
    "last_seen_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_pairing_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "redeemed_at" TIMESTAMPTZ,
    "redeemed_device_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "task_id" UUID,
    "step_id" UUID,
    "kind" "DeviceCommandKind" NOT NULL,
    "payload" JSONB,
    "command_digest" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "state" "DeviceCommandState" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "acked_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_organization_id_created_at_idx" ON "devices"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "devices_organization_id_status_idx" ON "devices"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organization_id_fingerprint_key" ON "devices"("organization_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_codes_code_hash_key" ON "device_pairing_codes"("code_hash");

-- CreateIndex
CREATE INDEX "device_pairing_codes_expires_at_idx" ON "device_pairing_codes"("expires_at");

-- CreateIndex
CREATE INDEX "device_pairing_codes_organization_id_created_at_idx" ON "device_pairing_codes"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "device_commands_device_id_state_seq_idx" ON "device_commands"("device_id", "state", "seq");

-- CreateIndex
CREATE INDEX "device_commands_organization_id_created_at_idx" ON "device_commands"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "device_commands_expires_at_idx" ON "device_commands"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_commands_device_id_seq_key" ON "device_commands"("device_id", "seq");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
