import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { type DeviceWorkspacePolicy, Uuid } from "@ua/contracts";
import { Public } from "../common/public.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DeviceAuthGuard } from "../devices/device-auth.guard.js";
import type { DevicePrincipal } from "../devices/device-principal.js";
import { CurrentDevice } from "../devices/device-principal.js";
import { WorkspacesService } from "./workspaces.service.js";

/**
 * The device's own view of what it may touch (FR-DEV-05, docs/planning/09 §6).
 *
 * `@Public()` is "no session": the guard authenticates an Ed25519 signature
 * instead, and the device can only ever be answered with its own rows — the
 * `:deviceId` in the path is part of the signed request, so naming another
 * device fails the signature rather than returning someone else's roots.
 */
@Public()
@Controller("v1/devices")
export class DeviceWorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get(":deviceId/workspaces")
  @UseGuards(DeviceAuthGuard)
  async policy(
    @CurrentDevice() device: DevicePrincipal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) _deviceId: string,
  ): Promise<DeviceWorkspacePolicy> {
    return this.workspaces.policyForDevice(device);
  }
}
