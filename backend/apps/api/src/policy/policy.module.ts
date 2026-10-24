import { Module } from "@nestjs/common";
import { PolicyController } from "./policy.controller.js";
import { PolicyService } from "./policy.service.js";

@Module({
  controllers: [PolicyController],
  providers: [PolicyService],
})
export class PolicyModule {}
