import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import {
  ApproveDeviceRequest,
  CreateDeviceCommandRequest,
  type CreateDeviceCommandResponse,
  CreatePairingCodeRequest,
  type DeviceListResponse,
  type DeviceSummary,
  type PairingCodeResponse,
  RevokeDeviceRequest,
  Uuid,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { DevicesService } from "./devices.service.js";

/**
 * The member's view of devices (docs/planning/07 §3.6, `12` §5.3–5.4).
 *
 * Every route here needs a live session: a device presenting its own key is a
 * different caller with a different authority, and it meets a different
 * controller (`device-channel.controller.ts`).
 */
@Controller("v1/devices")
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("pairing-codes")
  @HttpCode(201)
  async createPairingCode(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreatePairingCodeRequest)) _body: CreatePairingCodeRequest,
    @Req() request: FastifyRequest,
  ): Promise<PairingCodeResponse> {
    return this.devices.createPairingCode(principal, requestMeta(request, this.config));
  }

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<DeviceListResponse> {
    return { devices: await this.devices.list(principal.organizationId) };
  }

  @Get(":deviceId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) deviceId: string,
  ): Promise<DeviceSummary> {
    return this.devices.get(principal.organizationId, deviceId);
  }

  @Post(":deviceId/approve")
  @HttpCode(200)
  async approve(
    @CurrentPrincipal() principal: Principal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) deviceId: string,
    @Body(new ZodValidationPipe(ApproveDeviceRequest)) body: ApproveDeviceRequest,
    @Req() request: FastifyRequest,
  ): Promise<DeviceSummary> {
    return this.devices.approve(principal, deviceId, body, requestMeta(request, this.config));
  }

  @Post(":deviceId/deny")
  @HttpCode(200)
  async deny(
    @CurrentPrincipal() principal: Principal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) deviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<DeviceSummary> {
    return this.devices.deny(principal, deviceId, requestMeta(request, this.config));
  }

  @Post(":deviceId/revoke")
  @HttpCode(200)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) deviceId: string,
    @Body(new ZodValidationPipe(RevokeDeviceRequest)) body: RevokeDeviceRequest,
    @Req() request: FastifyRequest,
  ): Promise<DeviceSummary> {
    return this.devices.revoke(principal, deviceId, body, requestMeta(request, this.config));
  }

  @Post(":deviceId/commands")
  @HttpCode(201)
  async queueCommand(
    @CurrentPrincipal() principal: Principal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) deviceId: string,
    @Body(new ZodValidationPipe(CreateDeviceCommandRequest)) body: CreateDeviceCommandRequest,
    @Req() request: FastifyRequest,
  ): Promise<CreateDeviceCommandResponse> {
    return this.devices.queueCommand(principal, deviceId, body, requestMeta(request, this.config));
  }
}
