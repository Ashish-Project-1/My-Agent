import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Uuid } from "@ua/contracts";
import { z } from "zod";

/**
 * The one file this machine keeps: its identity and its place in the channel.
 *
 * A device is a keypair; losing this file loses the identity, and copying it
 * copies the device. It never lives inside a checkout for that reason.
 */
const StoredDevice = z.object({
  deviceId: Uuid,
  name: z.string().min(1),
  apiOrigin: z.string().min(1),
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * The highest command sequence this device has *acknowledged*, not the
   * highest it has been handed. A command it received but never finished stays
   * behind the cursor and is re-delivered, which is what at-least-once means
   * here (FR-DEV-04).
   */
  cursor: z.number().int().nonnegative(),
});

export type StoredDevice = z.infer<typeof StoredDevice>;

export function deviceFilePath(dataDir: string): string {
  return join(dataDir, "device.json");
}

export function loadDevice(dataDir: string): StoredDevice | null {
  const path = deviceFilePath(dataDir);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = StoredDevice.safeParse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  if (!parsed.success) {
    throw new Error(
      `${path} is not a device file: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

export function saveDevice(dataDir: string, device: StoredDevice): void {
  const path = deviceFilePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  // 0600 because the private key *is* the device; Windows ignores the mode.
  writeFileSync(path, `${JSON.stringify(device, null, 2)}\n`, { mode: 0o600 });
}
