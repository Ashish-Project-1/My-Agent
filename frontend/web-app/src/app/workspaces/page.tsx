"use client";

import type { DeviceSummary, WorkspaceGrantSummary, WorkspaceSummary } from "@ua/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createWorkspaceGrant,
  errorText,
  isSignedOut,
  listDevices,
  listWorkspaceGrants,
  listWorkspaces,
  registerWorkspace,
  removeWorkspace,
  revokeWorkspaceGrant,
} from "@/lib/api";

interface DeviceGroup {
  device: DeviceSummary;
  workspaces: WorkspaceSummary[];
}

export default function WorkspacesPage() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerDeviceId, setRegisterDeviceId] = useState("");
  const [registerPath, setRegisterPath] = useState("");
  const [registerLabel, setRegisterLabel] = useState("");
  const [registerMode, setRegisterMode] = useState<"read_write" | "read_only">("read_write");
  const [registering, setRegistering] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [grants, setGrants] = useState<Record<string, WorkspaceGrantSummary[]>>({});
  const [grantPath, setGrantPath] = useState<Record<string, string>>({});
  const [grantEffect, setGrantEffect] = useState<Record<string, "allow" | "deny">>({});
  const [granting, setGranting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deviceList, workspaceList] = await Promise.all([listDevices(), listWorkspaces()]);
      setDevices(deviceList.devices);
      const map = new Map<string, WorkspaceSummary[]>();
      for (const workspace of workspaceList.workspaces) {
        const items = map.get(workspace.deviceId) ?? [];
        items.push(workspace);
        map.set(workspace.deviceId, items);
      }
      const grouped: DeviceGroup[] = [];
      for (const device of deviceList.devices) {
        grouped.push({ device, workspaces: map.get(device.id) ?? [] });
      }
      // Include devices with no workspaces
      const seen = new Set(grouped.map((g) => g.device.id));
      for (const [deviceId, workspaces] of map.entries()) {
        if (seen.has(deviceId)) continue;
        const device = deviceList.devices.find((d) => d.id === deviceId);
        if (device) grouped.push({ device, workspaces });
      }
      setGroups(grouped);
    } catch (err) {
      if (isSignedOut(err)) {
        window.location.href = "/login";
        return;
      }
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRegister() {
    if (!registerDeviceId || !registerPath) return;
    setRegistering(true);
    setError(null);
    try {
      await registerWorkspace({
        deviceId: registerDeviceId,
        path: registerPath,
        mode: registerMode,
        ...(registerLabel.trim() ? { label: registerLabel.trim() } : {}),
      });
      setRegisterOpen(false);
      setRegisterPath("");
      setRegisterLabel("");
      setRegisterMode("read_write");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRegistering(false);
    }
  }

  async function handleRemove(workspaceId: string) {
    setError(null);
    try {
      await removeWorkspace(workspaceId);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function toggleGrants(workspaceId: string) {
    const next = new Set(expanded);
    if (next.has(workspaceId)) {
      next.delete(workspaceId);
    } else {
      next.add(workspaceId);
      if (!grants[workspaceId]) {
        try {
          const res = await listWorkspaceGrants(workspaceId);
          setGrants((prev) => ({ ...prev, [workspaceId]: res.grants }));
        } catch (err) {
          setError(errorText(err));
        }
      }
    }
    setExpanded(next);
  }

  async function handleCreateGrant(workspaceId: string) {
    const pathPattern = grantPath[workspaceId];
    if (!pathPattern) return;
    setGranting(workspaceId);
    setError(null);
    try {
      await createWorkspaceGrant(workspaceId, {
        pathPattern,
        effect: grantEffect[workspaceId] ?? "allow",
      });
      setGrantPath((prev) => ({ ...prev, [workspaceId]: "" }));
      const res = await listWorkspaceGrants(workspaceId);
      setGrants((prev) => ({ ...prev, [workspaceId]: res.grants }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGranting(null);
    }
  }

  async function handleRevokeGrant(workspaceId: string, grantId: string) {
    setError(null);
    try {
      await revokeWorkspaceGrant(grantId);
      const res = await listWorkspaceGrants(workspaceId);
      setGrants((prev) => ({ ...prev, [workspaceId]: res.grants }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Directories the runner may touch, per device. The canonical path is the authority; what
            was typed is shown for reference.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong"
        >
          Register workspace
        </button>
      </header>

      {error ? (
        <div className="rounded-control border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {registerOpen ? (
        <section className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-card">
          <div>
            <h2 className="text-base font-semibold">Register a directory</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Paths are canonicalised by the server; network shares, verbatim paths and escapes are
              refused.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-ink">Device</span>
              <select
                value={registerDeviceId}
                onChange={(e) => setRegisterDeviceId(e.target.value)}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="">Select a device…</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-ink">Mode</span>
              <select
                value={registerMode}
                onChange={(e) => setRegisterMode(e.target.value as "read_write" | "read_only")}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="read_write">Read & write</option>
                <option value="read_only">Read only</option>
              </select>
            </label>
            <label className="sm:col-span-2 space-y-1 text-sm">
              <span className="text-ink">Path</span>
              <input
                value={registerPath}
                onChange={(e) => setRegisterPath(e.target.value)}
                placeholder="e.g. C:\Projects\app or /srv/code"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
              />
            </label>
            <label className="sm:col-span-2 space-y-1 text-sm">
              <span className="text-ink">Label (optional)</span>
              <input
                value={registerLabel}
                onChange={(e) => setRegisterLabel(e.target.value)}
                placeholder="Defaults to the directory name"
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={registering || !registerDeviceId || !registerPath}
              onClick={() => void handleRegister()}
              className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {registering ? "Registering…" : "Register"}
            </button>
            <button
              type="button"
              onClick={() => setRegisterOpen(false)}
              className="rounded-control border border-line px-3 py-1.5 text-sm text-ink transition-colors duration-hover ease-standard hover:bg-surface-muted"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-ink-muted">No devices or workspaces yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.device.id} className="space-y-3">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">{group.device.name}</h2>
                  <p className="text-sm text-ink-muted">
                    {group.device.status} • {group.device.os}
                  </p>
                </div>
              </header>
              {group.workspaces.length === 0 ? (
                <p className="text-sm text-ink-muted">No workspaces registered for this device.</p>
              ) : (
                <div className="space-y-3">
                  {group.workspaces.map((workspace) => (
                    <article
                      key={workspace.id}
                      className="rounded-card border border-line bg-surface shadow-card"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">{workspace.label}</h3>
                            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                              {workspace.mode === "read_write" ? "read-write" : "read-only"}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-sm text-ink">{workspace.path}</p>
                          <p className="mt-1 text-xs text-ink-muted">
                            Typed: <span className="font-mono">{workspace.rawPath}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void toggleGrants(workspace.id)}
                            className="rounded-control border border-line px-3 py-1.5 text-sm text-ink transition-colors duration-hover ease-standard hover:bg-surface-muted"
                          >
                            {expanded.has(workspace.id) ? "Hide grants" : "Grants"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(workspace.id)}
                            className="rounded-control border border-line px-3 py-1.5 text-sm text-danger transition-colors duration-hover ease-standard hover:bg-danger/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {expanded.has(workspace.id) ? (
                        <div className="border-t border-line px-5 py-4">
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="flex-1 min-w-[240px] space-y-1 text-sm">
                              <span className="text-ink">Grant path</span>
                              <input
                                value={grantPath[workspace.id] ?? ""}
                                onChange={(e) =>
                                  setGrantPath((prev) => ({
                                    ...prev,
                                    [workspace.id]: e.target.value,
                                  }))
                                }
                                placeholder="C:\Users\a\Documents\inbox"
                                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
                              />
                            </label>
                            <label className="space-y-1 text-sm">
                              <span className="text-ink">Effect</span>
                              <select
                                value={grantEffect[workspace.id] ?? "allow"}
                                onChange={(e) =>
                                  setGrantEffect((prev) => ({
                                    ...prev,
                                    [workspace.id]: e.target.value as "allow" | "deny",
                                  }))
                                }
                                className="rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink"
                              >
                                <option value="allow">allow</option>
                                <option value="deny">deny</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={
                                granting === workspace.id || !(grantPath[workspace.id] ?? "")
                              }
                              onClick={() => void handleCreateGrant(workspace.id)}
                              className="rounded-control bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {granting === workspace.id ? "Adding…" : "Add grant"}
                            </button>
                          </div>
                          <div className="mt-4 space-y-2">
                            {(grants[workspace.id] ?? []).length === 0 ? (
                              <p className="text-sm text-ink-muted">No grants.</p>
                            ) : (
                              (grants[workspace.id] ?? []).map((grant) => (
                                <div
                                  key={grant.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-3 py-2"
                                >
                                  <div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <span
                                        className={
                                          grant.effect === "deny" ? "text-danger" : "text-success"
                                        }
                                      >
                                        {grant.effect}
                                      </span>
                                      <span className="font-mono text-ink">
                                        {grant.pathPattern}
                                      </span>
                                      {grant.expiresAt ? (
                                        <span className="text-xs text-ink-muted">expires</span>
                                      ) : (
                                        <span className="text-xs text-ink-muted">standing</span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeGrant(workspace.id, grant.id)}
                                    className="text-sm text-ink-muted transition-colors duration-hover ease-standard hover:text-ink"
                                  >
                                    Revoke
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
