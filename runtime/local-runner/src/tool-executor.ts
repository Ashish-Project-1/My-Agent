import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AckDeviceCommandRequest } from "@ua/contracts";
import {
  canonicalDeviceCommand,
  canonicalJson,
  canonicalToolAction,
  type DeviceCommandSummary,
  type DeviceWorkspacePolicy,
  ToolExecuteCommandPayload,
  validateWorkspacePath,
  WorkspaceWriteArguments,
  type WorkspaceWriteResult,
} from "@ua/contracts";
import {
  canonicalisePath,
  checkTargetAllowed,
  isWithin,
  type PathFlavour,
  type PathPatternRule,
} from "@ua/sandbox-manager";
import { enforcementRoots, type WorkspaceRootState } from "./workspace-roots.js";

/**
 * A tool command, executed on the device (docs/planning/09 §5.2, 17 Phase 5).
 *
 * Everything about the action is checked here a second time: the command digest
 * (the payload arrived unchanged), the action digest (the action is the one the
 * user approved), the workspace root (it is registered, usable and writable) and
 * the resolved target (it is inside that root). The API decided *whether*; this
 * decides *where*, because only this machine knows what the path really is.
 *
 * Fail-closed: anything the checks cannot prove is a refusal, never a guess.
 */
export interface ToolExecutionInput {
  readonly command: DeviceCommandSummary;
  readonly deviceId: string;
  readonly policy: DeviceWorkspacePolicy;
  readonly roots: readonly WorkspaceRootState[];
  readonly flavour: PathFlavour;
  readonly denied: readonly string[];
  readonly allowsMutations: boolean;
}

export interface ToolExecutionOutput {
  readonly ack: AckDeviceCommandRequest;
  /** The file that changed, for the operator's log. Never part of the ack. */
  readonly writtenPath: string | null;
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const failed = (error: string): ToolExecutionOutput => ({
  ack: { outcome: "failed", error: error.slice(0, 500) },
  writtenPath: null,
});

export function executeToolCommand(input: ToolExecutionInput): ToolExecutionOutput {
  if (!input.allowsMutations) {
    return failed("mutating tools are disabled: the sandbox self-test has not passed");
  }

  const parsed = ToolExecuteCommandPayload.safeParse(input.command.payload);
  if (!parsed.success) {
    return failed("malformed tool command payload");
  }
  const action = parsed.data;

  if (action.deviceId !== input.deviceId) {
    return failed("the command names another device");
  }

  const commandDigest = sha256Hex(
    canonicalDeviceCommand({
      deviceId: action.deviceId,
      kind: input.command.kind,
      payload: input.command.payload as Record<string, unknown>,
      expiresAt: input.command.expiresAt,
    }),
  );
  if (commandDigest !== input.command.commandDigest) {
    return failed("the command was modified in transit (digest mismatch)");
  }

  if (Date.parse(action.approvalExpiresAt) <= Date.now()) {
    return failed("the approval behind this command has expired");
  }

  const expectedActionDigest = sha256Hex(
    canonicalToolAction({
      tool: action.tool,
      toolVersion: action.toolVersion,
      arguments: action.arguments,
      deviceId: action.deviceId,
      workspaceId: action.workspaceId,
      policyVersion: action.policyVersion,
      expiresAt: action.approvalExpiresAt,
    }),
  );
  if (expectedActionDigest !== action.actionDigest) {
    return failed("the action does not match its approval (digest mismatch)");
  }

  if (action.tool !== "workspace.write_file") {
    return failed(`this runner cannot execute ${action.tool}`);
  }
  const args = WorkspaceWriteArguments.safeParse(action.arguments);
  if (!args.success) {
    return failed("invalid tool arguments");
  }
  const pathProblem = validateWorkspacePath(args.data.path);
  if (pathProblem !== null) {
    return failed(pathProblem);
  }

  const root = input.roots.find((state) => state.id === action.workspaceId);
  if (root === undefined || root.resolved === null) {
    return failed("the workspace is not usable on this machine");
  }
  if (!root.writable) {
    return failed("the workspace is registered read-only");
  }

  const segments = args.data.path.split(/[\\/]/);
  const name = segments[segments.length - 1] ?? "";
  const parent = join(root.resolved, ...segments.slice(0, -1));

  let realParent: string;
  try {
    mkdirSync(parent, { recursive: true });
    realParent = realpathSync.native(parent);
  } catch {
    return failed("the target directory cannot be created or resolved");
  }
  if (!isWithin(root.resolved, realParent, input.flavour)) {
    return failed("the target directory escapes the workspace");
  }

  const canonical = canonicalisePath(join(realParent, name), input.flavour);
  if (!canonical.ok) {
    return failed(`refused: ${canonical.reason}`);
  }
  const target = canonical.canonicalPath;

  const verdict = checkTargetAllowed({
    target,
    write: true,
    flavour: input.flavour,
    roots: enforcementRoots(input.roots),
    grants: grantsOf(input.policy),
    denied: input.denied,
  });
  if (!verdict.ok) {
    return failed(`refused: ${verdict.reason}`);
  }
  // A grant may allow a sibling directory, but this tool is scoped to the one
  // workspace the action named. Widening it here would make the approval's
  // "workspace" field decorative.
  if (verdict.root !== root.resolved) {
    return failed("the target is outside the named workspace");
  }

  // A pre-existing link at the final component would make the write land
  // somewhere the string check just approved under a different name.
  try {
    const info = lstatSync(target);
    if (info.isSymbolicLink()) {
      return failed("the target is a symbolic link");
    }
    if (info.isDirectory()) {
      return failed("the target is a directory");
    }
  } catch {
    // ENOENT is the normal case: the tool creates the file.
  }

  try {
    writeFileSync(target, args.data.content, "utf8");
  } catch {
    return failed("the file could not be written");
  }

  const payload: WorkspaceWriteResult = {
    path: args.data.path,
    bytes: Buffer.byteLength(args.data.content, "utf8"),
    sha256: sha256Hex(args.data.content),
  };
  return {
    ack: {
      outcome: "acked",
      result: { payload, digest: sha256Hex(canonicalJson(payload)) },
    },
    writtenPath: target,
  };
}

function grantsOf(policy: DeviceWorkspacePolicy): PathPatternRule[] {
  return policy.grants.map((grant) => ({ pattern: grant.pathPattern, effect: grant.effect }));
}
