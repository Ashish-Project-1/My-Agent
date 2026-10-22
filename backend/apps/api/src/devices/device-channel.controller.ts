import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AckDeviceCommandRequest,
  type DeviceCommandListResponse,
  DeviceCommandQuery,
  RegisterDeviceRequest,
  type RegisterDeviceResponse,
  Uuid,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";
import { Public } from "../common/public.decorator.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { DeviceAuthGuard } from "./device-auth.guard.js";
import type { DevicePrincipal } from "./device-principal.js";
import { CurrentDevice } from "./device-principal.js";
import { DevicesService } from "./devices.service.js";

/**
 * The device's own HTTP surface (docs/planning/07 §3.6).
 *
 * `@Public()` here means "no session": every route is authenticated by the
 * device's Ed25519 signature instead, either against a key the device already
 * registered (the guard) or against the key it presents while registering
 * itself. A route added to this controller without one of those two is a route
 * that anyone can call, which is why there are exactly three.
 */
@Public()
@Controller("v1/devices")
export class DeviceChannelController {
  constructor(
    private readonly devices: DevicesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Register a presented device (FR-DEV-01). The pairing code is what ties it to
   * an organization, and the signature is what proves the device holds the
   * private half of the key it is claiming.
   */
  @Post()
  @HttpCode(201)
  async register(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(RegisterDeviceRequest)) body: RegisterDeviceRequest,
  ): Promise<RegisterDeviceResponse> {
    return {
      device: await this.devices.register(request, body, requestMeta(request, this.config)),
    };
  }

  /** Long-poll for work; `waitSeconds: 0` returns immediately. */
  @Get(":deviceId/commands")
  @UseGuards(DeviceAuthGuard)
  async commands(
    @CurrentDevice() device: DevicePrincipal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) _deviceId: string,
    @Query(new ZodValidationPipe(DeviceCommandQuery)) query: DeviceCommandQuery,
  ): Promise<DeviceCommandListResponse> {
    return this.devices.pollCommands(device, query);
  }

  @Post(":deviceId/commands/:commandId/ack")
  @HttpCode(204)
  @UseGuards(DeviceAuthGuard)
  async ack(
    @CurrentDevice() device: DevicePrincipal,
    @Param("deviceId", new ZodValidationPipe(Uuid)) _deviceId: string,
    @Param("commandId", new ZodValidationPipe(Uuid)) commandId: string,
    @Body(new ZodValidationPipe(AckDeviceCommandRequest)) body: AckDeviceCommandRequest,
  ): Promise<void> {
    await this.devices.ackCommand(device, commandId, body);
  }
}
