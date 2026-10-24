/**
 * The `action` vocabulary written to `audit_events`.
 *
 * The planning docs fix the columns and the retention (docs/planning/06 §3) but
 * not the values, so the rule is stated once here: `<resource>.<verb>`, present
 * tense, naming the act that was attempted. Whether it succeeded is the separate
 * `result` column, so a failure is never a different action and an audit search
 * for one act does not have to know about its failure spelling.
 */
export const AUDIT_ACTIONS = {
  userRegister: "user.register",
  authLogin: "auth.login",
  authRefresh: "auth.refresh",
  authLogout: "auth.logout",
  organizationCreate: "organization.create",
  taskCreate: "task.create",
  devicePairingCodeCreate: "device.pairing_code.create",
  deviceRegister: "device.register",
  deviceApprove: "device.approve",
  deviceRevoke: "device.revoke",
  deviceCommandCreate: "device.command.create",
  workspaceCreate: "workspace.create",
  workspaceUpdate: "workspace.update",
  workspaceRemove: "workspace.remove",
  workspaceGrantCreate: "workspace.grant.create",
  workspaceGrantRevoke: "workspace.grant.revoke",
  approvalGrant: "approval.grant",
  approvalDeny: "approval.deny",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
