import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { digest } from "../identity/tokens.js";

/**
 * The per-request facts written alongside a security-relevant action.
 *
 * The address and the user-agent are stored as keyed digests, never verbatim
 * (docs/planning/06 §3): `login_attempts` and `audit_events` are long-lived, and
 * an IP address is personal data. The raw user-agent is still kept on the
 * session, where it is shown back to the user as "your devices", and is bounded
 * because the client chooses its length.
 */
export interface RequestMeta {
  readonly ipHash: string;
  readonly userAgentDigest: string;
  readonly userAgent: string | null;
  readonly traceId: string | null;
}

const MAX_USER_AGENT_LENGTH = 300;

export function requestMeta(request: FastifyRequest, config: AppConfig): RequestMeta {
  const header = request.headers["user-agent"];
  const userAgent = typeof header === "string" ? header.slice(0, MAX_USER_AGENT_LENGTH) : null;

  return {
    ipHash: digest(config.digestSecret, "ip", request.ip),
    userAgentDigest: digest(config.digestSecret, "user-agent", userAgent ?? "unknown"),
    userAgent,
    traceId: request.context?.traceId ?? null,
  };
}
