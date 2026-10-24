"use client";

import type { ApprovalRequestSummary, ApprovalState } from "@ua/contracts";
import { useCallback, useEffect, useState } from "react";
import { denyApproval, errorText, grantApproval, isSignedOut, listApprovals } from "@/lib/api";

type StateFilter = ApprovalState | "all";

const FILTERS: { value: StateFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All" },
];

/**
 * The approval inbox (docs/planning/10 §4).
 *
 * A decision sends the digest that was on screen. If the action changed in the
 * meantime the API refuses rather than approving a different one, so the page
 * reloads on that error instead of guessing.
 */
export default function ApprovalsPage() {
  const [filter, setFilter] = useState<StateFilter>("pending");
  const [approvals, setApprovals] = useState<ApprovalRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listApprovals(filter === "all" ? {} : { state: filter });
      setApprovals(response.approvals);
    } catch (err) {
      if (isSignedOut(err)) {
        window.location.href = "/login";
        return;
      }
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(approval: ApprovalRequestSummary, grant: boolean) {
    setDeciding(approval.id);
    setError(null);
    try {
      const body = {
        actionDigest: approval.actionDigest,
        scope: grant ? ("once" as const) : undefined,
      };
      await (grant ? grantApproval : denyApproval)(approval.id, body as any);
      await load();
    } catch (err) {
      setError(errorText(err));
      // A stale digest or a decided row means the list is out of date.
      await load();
    } finally {
      setDeciding(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Each request refers to one exact action. Approving it allows that action once; if it
            changes, the request no longer applies.
          </p>
        </div>
        <label className="space-y-1 text-sm">
          <span className="text-ink">Show</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StateFilter)}
            className="block rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div className="rounded-control border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : approvals.length === 0 ? (
        <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-ink-muted">Nothing to show.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <article
              key={approval.id}
              className="rounded-card border border-line bg-surface shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">{approval.toolName}</span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                      {approval.riskClass}
                    </span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                      {approval.state}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
                    {approval.summary}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">
                    Task <span className="font-mono">{approval.taskId}</span> • step{" "}
                    <span className="font-mono">{approval.stepId}</span> • expires{" "}
                    {new Date(approval.expiresAt).toLocaleString()}
                  </p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{approval.actionDigest}</p>
                </div>
                {approval.state === "pending" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={deciding === approval.id}
                      onClick={() => void decide(approval, true)}
                      className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deciding === approval.id ? "Working…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={deciding === approval.id}
                      onClick={() => void decide(approval, false)}
                      className="rounded-control border border-line px-3 py-1.5 text-sm text-danger transition-colors duration-hover ease-standard hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">
                    {approval.decidedAt
                      ? `Decided ${new Date(approval.decidedAt).toLocaleString()}`
                      : "Not decided"}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
