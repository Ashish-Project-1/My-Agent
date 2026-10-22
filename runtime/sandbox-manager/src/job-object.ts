/**
 * Windows Job Object containment (docs/planning/09 §5, §8).
 *
 * This module provides the shape of the sandbox host's process control. The
 * actual Win32 calls (CreateJobObject, AssignProcessToJobObject,
 * SetInformationJobObject with JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
 * TerminateJobObject) are implemented behind `JobObjectController` so that:
 * - unit tests can use an in-memory controller,
 * - non-Windows platforms can run the logic without native bindings,
 * - the runner can swap in a native implementation without changing call sites.
 *
 * Default posture is "fail closed": if containment cannot be established, the
 * sandbox must not run mutating tools (enforced by the self-test).
 */

export interface JobObjectLimits {
  /** Kill the entire job when the handle is closed (process-tree kill). */
  readonly killOnJobClose: boolean;
  /** Maximum working set / commit size in bytes (0 = no limit). */
  readonly processMemoryLimitBytes: number;
  /** Maximum number of active processes in the job (0 = no limit). */
  readonly activeProcessLimit: number;
  /** Wall-clock limit in milliseconds for processes in the job (0 = no limit). */
  readonly perProcessTimeLimitMs: number;
}

export const DEFAULT_JOB_LIMITS: JobObjectLimits = {
  killOnJobClose: true,
  processMemoryLimitBytes: 0,
  activeProcessLimit: 0,
  perProcessTimeLimitMs: 0,
};

export interface JobObjectHandle {
  readonly id: string;
}

export interface JobObjectController {
  /** Create a new job object configured with the given limits. */
  create(limits: JobObjectLimits): Promise<JobObjectHandle>;
  /** Assign a process (by pid) to the job object. */
  assign(handle: JobObjectHandle, pid: number): Promise<void>;
  /** Terminate every process in the job object. */
  terminate(handle: JobObjectHandle, exitCode?: number): Promise<void>;
  /** Close and release the job object handle. */
  close(handle: JobObjectHandle): Promise<void>;
  /** Whether job objects are supported on this platform/runtime. */
  supported(): boolean;
}

/**
 * An in-memory controller for tests and non-Windows environments. It records
 * calls and can simulate failures; it does not actually kill processes.
 */
export class InMemoryJobObjectController implements JobObjectController {
  private nextId = 1;
  private readonly jobs = new Map<string, { limits: JobObjectLimits; pids: Set<number> }>();

  supported(): boolean {
    return true;
  }

  async create(limits: JobObjectLimits): Promise<JobObjectHandle> {
    const id = `job-${this.nextId++}`;
    this.jobs.set(id, { limits, pids: new Set() });
    return { id };
  }

  async assign(handle: JobObjectHandle, pid: number): Promise<void> {
    const job = this.jobs.get(handle.id);
    if (!job) throw new Error(`unknown job object: ${handle.id}`);
    job.pids.add(pid);
  }

  async terminate(handle: JobObjectHandle, _exitCode = 1): Promise<void> {
    const job = this.jobs.get(handle.id);
    if (!job) throw new Error(`unknown job object: ${handle.id}`);
    // In tests we just record the intent; real implementation terminates the tree.
    job.pids.clear();
  }

  async close(handle: JobObjectHandle): Promise<void> {
    if (!this.jobs.has(handle.id)) throw new Error(`unknown job object: ${handle.id}`);
    this.jobs.delete(handle.id);
  }

  /** For tests: return the set of pids assigned to a job. */
  assignedPids(handle: JobObjectHandle): number[] {
    const job = this.jobs.get(handle.id);
    return job ? Array.from(job.pids) : [];
  }
}
