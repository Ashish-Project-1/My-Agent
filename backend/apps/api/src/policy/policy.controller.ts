import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard.js";
import { PolicyService } from "./policy.service.js";

@Controller("policy")
@UseGuards(AuthGuard)
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get("effective")
  getEffective() {
    return this.policy.getEffective();
  }
}
