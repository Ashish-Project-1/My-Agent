"use client";

import type { DeviceSummary, PairingCodeResponse } from "@ua/contracts";
import { type ReactNode, useState } from "react";
import { SignInPrompt } from "@/components/sign-in-prompt";
import {
  approveDevice,
  createPairingCode,
  denyDevice,
  errorText,
  isSignedOut,
  listDevices,
  revokeDevice,
  runDeviceDiagnostics,
} from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useAsync } from "@/lib/use-async";

const STATUS_TONE: Record<DeviceSummary["status"], string> = {
  pending: "bg-warning/12 text-warning",
  active: "bg-success/10 text-success",
  revoked: "bg-ink/8 text-ink-muted",
};

const STATUS_NOTE: Record<DeviceSummary["status"], string> = {
  pending: "Registered, waiting for someone to approve it.",
  active: "Approved. It can be given work.",
  revoked: "Refused. It cannot be used again.",
};

/** What the machine said it can do (FR-DEV-02). Absent capabilities read as
 * "nothing reported" rather than as a machine that can do nothing. */
function capabilityLine(device: DeviceSummary): string {
  const capabilities = device.capabilities;
  if (capabilities === null) return "No capabilities reported";
  const parts: string[] = [];
  if (capabilities.gpu !== undefined) parts.push(`GPU ${capabilities.gpu.name}`);
  const models = capabilities.models ?? [];
  if (models.length > 0) parts.push(`${models.length} models`);
  if (capabilities.playwright === true) parts.push("Playwright");
  const commands = capabilities.commands ?? [];
  if (commands.length > 0) parts.push(`${commands.length} commands`);
  return parts.length === 0 ? "No capabilities reported" : parts.join(" · ");
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-control px-3 py-1.5 text-sm font-medium transition-colors duration-hover ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "text-danger hover:bg-danger/10" : "text-ink-muted hover:text-ink hover:bg-ink/5"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Devices (FR-AUTH-07, FR-DEV-01/02).
 *
 * Pairing is a two-step handshake and the browser only drives the first: it
 * mints a code, the person types it into the runner, and the machine registers
 * itself with a key the browser never sees. Approval is the human half — a
 * device that registered with a valid code still has no authority until someone
 * says so here (docs/planning/07 §3.6).
 */
export default function DevicesPage() {
  const devices = useAsync(listDevices);
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const [pairing, setPairing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startPairing() {
    setPairing(true);
    setError(null);
    setNotice(null);
    try {
      setCode(await createPairingCode());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPairing(false);
    }
  }

  async function act(deviceId: string, run: () => Promise<unknown>, message: string) {
    setBusy(deviceId);
    setError(null);
    setNotice(null);
    try {
      await run();
      setNotice(message);
      devices.reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(device: DeviceSummary) {
    const reason = window.prompt(`Why are you revoking ${device.name}?`);
    if (reason === null || reason.trim() === "") return;
    await act(
      device.id,
      () => revokeDevice(device.id, { reason: reason.trim() }),
      "Device revoked.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Machines that can run work for this organization, and the people who approved them.
          </p>
        </div>
        <button
          type="button"
          onClick={startPairing}
          disabled={pairing}
          className="shrink-0 rounded-control bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pairing ? "Preparing…" : "Pair a device"}
        </button>
      </div>

      {code !== null && (
        <section className="space-y-3 rounded-card border border-line bg-surface p-6 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Pairing code</h2>
              <p className="mt-1 text-sm text-ink-muted">
                On the machine you want to add, run this before {formatWhen(code.expiresAt)}:
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCode(null)}
              className="shrink-0 rounded-control px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-hover ease-standard hover:text-ink"
            >
              Done
            </button>
          </div>
          <p className="font-mono text-2xl tracking-[0.2em]">{code.code}</p>
          <pre className="overflow-auto rounded-control bg-canvas px-3 py-2 font-mono text-xs text-ink-muted">
            ua-runner pair --code {code.code}
          </pre>
          <p className="text-xs text-ink-subtle">
            The runner registers itself, then appears below as pending until you approve it. The
            code is shown once and accepted once.
          </p>
        </section>
      )}

      {notice !== null && (
        <p className="rounded-card border border-success/30 bg-success/5 p-3 text-sm text-success">
          {notice}
        </p>
      )}

      {error !== null && (
        <p className="rounded-card border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {devices.status === "loading" && <p className="text-sm text-ink-subtle">Loading devices…</p>}

      {devices.status === "error" &&
        (isSignedOut(devices.error) ? (
          <SignInPrompt noun="your devices" />
        ) : (
          <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {errorText(devices.error)}
          </div>
        ))}

      {devices.status === "ready" && devices.value.devices.length === 0 && (
        <p className="rounded-card border border-line bg-surface p-8 text-center text-sm text-ink-muted">
          No devices yet. Pair one to let an agent run work on a machine you own.
        </p>
      )}

      {devices.status === "ready" && devices.value.devices.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {devices.value.devices.map((device) => (
            <li key={device.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{device.name}</span>
                <span
                  className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_TONE[device.status]}`}
                >
                  {device.status}
                </span>
                <span className="ml-auto text-xs text-ink-subtle">
                  {device.lastSeenAt === null
                    ? "Never connected"
                    : `Seen ${formatWhen(device.lastSeenAt)}`}
                </span>
              </div>

              <p className="text-xs text-ink-subtle">
                {device.os}
                {device.osVersion === null ? "" : ` ${device.osVersion}`} · runner{" "}
                {device.runnerVersion} · key{" "}
                <span className="font-mono">{device.fingerprint.slice(0, 16)}</span>
              </p>
              <p className="text-xs text-ink-subtle">{capabilityLine(device)}</p>
              <p className="text-xs text-ink-subtle">{STATUS_NOTE[device.status]}</p>

              <div className="flex flex-wrap gap-1">
                {device.status === "pending" && (
                  <>
                    <ActionButton
                      disabled={busy === device.id}
                      onClick={() =>
                        act(
                          device.id,
                          () => approveDevice(device.id, {}),
                          `${device.name} approved.`,
                        )
                      }
                    >
                      Approve
                    </ActionButton>
                    <ActionButton
                      danger
                      disabled={busy === device.id}
                      onClick={() => act(device.id, () => denyDevice(device.id), "Device denied.")}
                    >
                      Deny
                    </ActionButton>
                  </>
                )}

                {device.status === "active" && (
                  <>
                    <ActionButton
                      disabled={busy === device.id}
                      onClick={() =>
                        act(
                          device.id,
                          () => runDeviceDiagnostics(device.id),
                          `Diagnostics requested from ${device.name}.`,
                        )
                      }
                    >
                      Run diagnostics
                    </ActionButton>
                    <ActionButton
                      danger
                      disabled={busy === device.id}
                      onClick={() => {
                        void revoke(device);
                      }}
                    >
                      Revoke
                    </ActionButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
