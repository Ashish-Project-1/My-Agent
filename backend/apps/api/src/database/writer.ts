import type { PrismaClient } from "@ua/database";

/**
 * The model delegates a unit of work may touch.
 *
 * `$transaction` hands the callback a client that keeps every model but drops
 * connection control, so this shape covers both the pool and a transaction —
 * which is what lets one repository method run inside or outside a transaction
 * without a second overload.
 */
export type DbWriter = Pick<
  PrismaClient,
  | "users"
  | "organizations"
  | "memberships"
  | "sessions"
  | "refresh_tokens"
  | "login_attempts"
  | "audit_events"
  | "agent_sessions"
  | "tasks"
  | "task_events"
  | "devices"
  | "device_pairing_codes"
  | "device_commands"
  | "workspaces"
  | "workspace_grants"
  | "approval_requests"
  | "policy_decisions"
  | "outbox"
  | "idempotency_keys"
>;
