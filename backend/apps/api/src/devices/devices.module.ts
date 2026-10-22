import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DeviceAuthGuard } from "./device-auth.guard.js";
import { DeviceChannelController } from "./device-channel.controller.js";
import { DevicesController } from "./devices.controller.js";
import { DevicesRepository } from "./devices.repository.js";
import { DevicesService } from "./devices.service.js";

/**
 * Devices own `devices`, `device_pairing_codes` and `device_commands`
 * (docs/planning/03 §4). Nothing outside this module queries them.
 *
 * The guard is exported for the same reason the service and the repository are:
 * a device-signed route in another module (workspaces) authenticates with this
 * guard rather than a second copy of the signature check, and Nest builds the
 * guard in the module that declares the controller — so the repository it needs
 * has to be visible there too.
 */
@Module({
  imports: [AuditModule],
  controllers: [DevicesController, DeviceChannelController],
  providers: [DevicesRepository, DevicesService, DeviceAuthGuard],
  exports: [DevicesService, DevicesRepository, DeviceAuthGuard],
})
export class DevicesModule {}
