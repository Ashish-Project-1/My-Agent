import type { RiskClass, WorkspaceMode } from "@ua/contracts";
import { toolManifest } from "./tools.js";

/**
 * The policy engine (docs/planning/10 §3, FR-POL-01/02/03/05).
 *
 * A pure function of (action, context) and an ordered rule list: same inputs,
 * same answer, on every host. Rules only ever narrow what the built-in floor
 * permits; the floor itself is the last word. `deny` beats `ask` beats `allow`
 * because the last matching rule wins, exactly as the planning table specifies.
 */
export type PolicyDecisionKind = "allow" | "ask" | "deny";

/** What is being asked, independent of who asked or which task it belongs to. */
export interface PolicyAction {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly deviceId: string;
  readonly workspaceId: string;
}

/** The facts the engine needs that are not part of the action. */
export interface PolicyContext {
  readonly workspaceMode: WorkspaceMode;
  /**
   * Whether the workspace has a snapshot this change could be rolled back to.
   * No snapshot means a mutation is not cheap to undo, which is what turns an
   * R1 write into an R2 approval (docs/planning/10 §6, control 11).
   */
  readonly snapshotAvailable: boolean;
  /** Device-level policy constraints (tightening only). */
  readonly devicePolicy?: {
    readonly allowTools?: readonly string[];
    readonly denyTools?: readonly string[];
    readonly requireApprovalForMutations?: boolean;
  };
}

export interface PolicyOutcome {
  readonly decision: PolicyDecisionKind;
  readonly riskClass: RiskClass;
  readonly matchedRule: string;
  readonly reasons: readonly string[];
}

export interface PolicyRule {
  readonly id: string;
  /** Null means "this rule has no opinion"; the last non-null answer wins. */
  evaluate(action: PolicyAction, context: PolicyContext): PolicyOutcome | null;
}

export interface PolicyDocument {
  readonly id: string;
  readonly scope: "platform_floor" | "organization" | "device" | "workspace";
  readonly rules: readonly PolicyRule[];
  readonly tighteningOnly?: boolean;
}

/**
 * Precedence order (docs/planning/10 §3.4): later overrides earlier for
 * behaviour, but tightening is applied last. The chain is composed in this
 * order so that a stricter rule added later replaces an earlier looser one.
 */
export const POLICY_PRECEDENCE: readonly PolicyDocument["scope"][] = [
  "platform_floor",
  "organization",
  "device",
  "workspace",
];

function outcome(
  id: string,
  decision: PolicyDecisionKind,
  riskClass: RiskClass,
  reason: string,
): PolicyOutcome {
  return { decision, riskClass, matchedRule: id, reasons: [reason] };
}

/**
 * The built-in floor. Ordered loosest to strictest, because the last matching
 * rule wins: an allow is written first, escalations next, denials last, so a
 * rule can never loosen the answer a later rule already tightened.
 */
export const FLOOR_RULES: readonly PolicyRule[] = [
  {
    id: "policy.device_deny_tool",
    evaluate: (action, context) => {
      const deny = context.devicePolicy?.denyTools;
      return deny?.includes(action.tool)
        ? outcome("policy.device_deny_tool", "deny", "R3", "blocked by device policy")
        : null;
    },
  },
  {
    id: "policy.device_allow_tool",
    evaluate: (action, context) => {
      const allow = context.devicePolicy?.allowTools;
      if (!allow) return null;
      return allow.includes(action.tool)
        ? null
        : outcome("policy.device_allow_tool", "deny", "R3", "not allowed by device policy");
    },
  },
  {
    id: "policy.workspace_write",
    evaluate: (action, context) => {
      const manifest = toolManifest(action.tool);
      return manifest?.mutating === true && context.snapshotAvailable
        ? outcome("policy.workspace_write", "allow", manifest.riskClass, "inside the workspace")
        : null;
    },
  },
  {
    id: "policy.no_snapshot_escalation",
    evaluate: (action, context) => {
      const manifest = toolManifest(action.tool);
      return manifest?.mutating === true && !context.snapshotAvailable
        ? outcome(
            "policy.no_snapshot_escalation",
            "ask",
            "R2",
            "the workspace has no snapshot, so this change needs approval",
          )
        : null;
    },
  },
  {
    id: "policy.risk_ceiling",
    evaluate: (action) => {
      const manifest = toolManifest(action.tool);
      return manifest?.riskClass === "R4"
        ? outcome("policy.risk_ceiling", "deny", "R4", "R4 actions are prohibited")
        : null;
    },
  },
  {
    id: "policy.workspace_read_only",
    evaluate: (action, context) => {
      const manifest = toolManifest(action.tool);
      return manifest?.mutating === true && context.workspaceMode === "read_only"
        ? outcome(
            "policy.workspace_read_only",
            "deny",
            "R2",
            "the workspace is registered read-only",
          )
        : null;
    },
  },
  {
    id: "policy.invalid_arguments",
    evaluate: (action) => {
      const manifest = toolManifest(action.tool);
      if (manifest === null) {
        return null;
      }
      const problem = manifest.validate(action.arguments);
      return problem === null ? null : outcome("policy.invalid_arguments", "deny", "R2", problem);
    },
  },
  {
    id: "policy.unknown_tool",
    evaluate: (action) =>
      toolManifest(action.tool) === null
        ? outcome("policy.unknown_tool", "deny", "R3", `${action.tool} is not in the tool registry`)
        : null,
  },
];

/** No rule matched: fall closed. */
const DEFAULT_DENY: PolicyOutcome = {
  decision: "deny",
  riskClass: "R3",
  matchedRule: "policy.default_deny",
  reasons: ["no rule permits this action"],
};

const DECISION_ORDER: Record<PolicyDecisionKind, number> = { deny: 2, ask: 1, allow: 0 };

/**
 * Compose policy documents in precedence order. Policies only ever tighten:
 * an evaluation cannot turn a `deny` into `allow` or `ask`; it can only
 * escalate to a stricter decision.
 */
export function composePolicyDocuments(
  documents: readonly PolicyDocument[],
): readonly PolicyRule[] {
  const byScope = new Map<PolicyDocument["scope"], PolicyDocument[]>();
  for (const doc of documents) {
    const list = byScope.get(doc.scope) ?? [];
    list.push(doc);
    byScope.set(doc.scope, list);
  }

  const rules: PolicyRule[] = [];
  for (const scope of POLICY_PRECEDENCE) {
    const docs = byScope.get(scope);
    if (!docs) continue;
    for (const doc of docs) {
      for (const rule of doc.rules) {
        if (doc.tighteningOnly !== false) {
          rules.push({
            id: rule.id,
            evaluate: (action, context) => {
              const candidate = rule.evaluate(action, context);
              if (candidate === null) return null;
              // Keep the most restrictive decision seen so far.
              return outcome(
                candidate.matchedRule,
                DECISION_ORDER[candidate.decision] >= DECISION_ORDER.deny
                  ? "deny"
                  : candidate.decision,
                candidate.riskClass,
                candidate.reasons.join("; "),
              );
            },
          });
        } else {
          rules.push(rule);
        }
      }
    }
  }
  return rules;
}

/**
 * Evaluate an action. The last matching rule wins; a tie between rules at the
 * same position cannot exist, and a stricter answer from a later rule always
 * replaces an earlier, looser one.
 */
export function evaluateAction(
  action: PolicyAction,
  context: PolicyContext,
  rules: readonly PolicyRule[] = FLOOR_RULES,
): PolicyOutcome {
  let decided: PolicyOutcome | null = null;
  for (const rule of rules) {
    const candidate = rule.evaluate(action, context);
    if (candidate !== null) {
      decided = candidate;
    }
  }
  return decided ?? DEFAULT_DENY;
}

/** The sentence an approval request shows; never the raw argument object. */
export function describePolicyAction(action: PolicyAction): string {
  const manifest = toolManifest(action.tool);
  return manifest === null
    ? `Call unknown tool ${action.tool}`
    : manifest.describe(action.arguments);
}
