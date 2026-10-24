import { Injectable } from "@nestjs/common";
import type { Principal } from "../common/principal.js";

@Injectable()
export class PolicyService {
  constructor(private readonly principal: Principal) {}

  getEffective() {
    return {
      organizationId: this.principal.organizationId,
      version: "1",
      floor: [
        "policy.workspace_write",
        "policy.no_snapshot_escalation",
        "policy.risk_ceiling",
        "policy.workspace_read_only",
        "policy.invalid_arguments",
        "policy.unknown_tool",
        "policy.device_deny_tool",
        "policy.device_allow_tool",
      ],
      tighteningOnly: true,
    };
  }
}
