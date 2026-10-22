import { Injectable } from "@nestjs/common";
import type { AuditActorType, AuditResult } from "@ua/database";
// Value import: Nest reads the injected token from decorator metadata, which a
// type-only import would erase.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

/**
 * Values safe to persist in `metadata`: flat and primitive, because the column
 * is written by this one class and a redaction pass (docs/planning/06 §6) has to
 * be able to walk it without meeting a class instance or a function.
 */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEvent {
  /** Null for an event that happened before a tenant was known, such as a failed sign-in. */
  readonly organizationId: string | null;
  readonly actorType: AuditActorType;
  /** The user who acted. Null when the actor is a device (`deviceId` names it). */
  readonly actorId: string | null;
  /** The device that acted, when it named itself with its own key (FR-DEV-01). */
  readonly deviceId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly result?: AuditResult;
  readonly reason?: string | null;
  readonly ipHash?: string | null;
  readonly userAgentDigest?: string | null;
  readonly traceId?: string | null;
  readonly metadata?: AuditMetadata;
}

/**
 * The audit write path.
 *
 * `record` takes the writer so the row lands in the caller's transaction: an
 * action and its audit row commit together or not at all (docs/planning/07 §1).
 * When the call has no transaction — a rejected sign-in has nothing else to
 * write — the pool client is used by default.
 */
@Injectable()
export class AuditService {
  constructor(private readonly database: UnscopedDatabase) {}

  async record(event: AuditEvent, writer: DbWriter = this.database.client): Promise<void> {
    await writer.audit_events.create({
      data: {
        organization_id: event.organizationId,
        actor_type: event.actorType,
        actor_id: event.actorId,
        device_id: event.deviceId ?? null,
        action: event.action,
        resource_type: event.resourceType,
        resource_id: event.resourceId ?? null,
        result: event.result ?? "success",
        reason: event.reason ?? null,
        ip_hash: event.ipHash ?? null,
        user_agent_digest: event.userAgentDigest ?? null,
        trace_id: event.traceId ?? null,
        ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
      },
    });
  }
}
