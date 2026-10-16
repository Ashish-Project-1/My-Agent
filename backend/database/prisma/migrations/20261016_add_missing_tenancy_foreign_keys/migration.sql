-- Two tenant/user references were left as bare uuids, which the schema rule in
-- docs/planning/06 §1 ("real FK constraints, ON DELETE RESTRICT by default")
-- does not allow: idempotency_keys.organization_id carries a tenant's data with
-- no guarantee the organization exists, and memberships.invited_by can dangle.
-- Additive and non-destructive: no rows move, no column changes type.

-- CreateTable back-relations are implicit in Prisma, so only the constraints are
-- needed here.
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
