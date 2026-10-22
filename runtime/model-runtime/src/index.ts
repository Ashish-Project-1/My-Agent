/**
 * Model runtime (docs/planning/03 §5.11, 09 §6).
 *
 * Manages local models (Ollama) with `OLLAMA_MODELS` on `F:` when available,
 * inventories models, supervises `ollama serve`, and exposes capabilities to the
 * runner.
 */

import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OllamaModel {
  readonly name: string;
  readonly size?: number;
  readonly digest?: string;
  readonly modifiedAt?: string;
}

export interface OllamaStatus {
  readonly running: boolean;
  readonly baseUrl: string;
  readonly modelsDir?: string;
  readonly models: readonly OllamaModel[];
  readonly error?: string;
}

export interface OllamaOptions {
  readonly baseUrl?: string;
  readonly modelsDir?: string;
}

function defaultModelsDir(): string {
  if (process.env.OLLAMA_MODELS) return process.env.OLLAMA_MODELS;
  const candidate = "F:/ollama/models";
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class OllamaRuntime {
  private readonly baseUrl: string;
  private readonly modelsDir: string;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
    this.modelsDir = options.modelsDir ?? defaultModelsDir();
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModelsDir(): string {
    return this.modelsDir;
  }

  async checkModelsDir(): Promise<{ ok: boolean; path: string; error?: string }> {
    const ok = await pathExists(this.modelsDir);
    return ok
      ? { ok: true, path: this.modelsDir }
      : { ok: false, path: this.modelsDir, error: "not found" };
  }

  async listModels(): Promise<readonly OllamaModel[]> {
    try {
      const { stdout } = await execFileAsync("ollama", ["list"], { timeout: 5000 });
      const lines = stdout.split(/\r?\n/).filter((l: string) => l.trim() !== "");
      const models: OllamaModel[] = [];
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts[0]) models.push({ name: parts[0] });
      }
      if (models.length > 0) return models;
    } catch {
      // fall through to HTTP
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = (await res.json()) as {
        models?: Array<{ name?: string; size?: number; digest?: string; modified_at?: string }>;
      };
      const models: OllamaModel[] = [];
      for (const m of json.models ?? []) {
        if (!m.name) continue;
        const entry: OllamaModel = { name: m.name };
        if (typeof m.size === "number") (entry as { size?: number }).size = m.size;
        if (typeof m.digest === "string") (entry as { digest?: string }).digest = m.digest;
        if (typeof m.modified_at === "string")
          (entry as { modifiedAt?: string }).modifiedAt = m.modified_at;
        models.push(entry);
      }
      return models;
    } catch (err) {
      throw err;
    }
  }

  async status(): Promise<OllamaStatus> {
    try {
      const models = await this.listModels();
      return { running: true, baseUrl: this.baseUrl, modelsDir: this.modelsDir, models };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        running: false,
        baseUrl: this.baseUrl,
        modelsDir: this.modelsDir,
        models: [],
        error,
      };
    }
  }

  async ensureRunning(): Promise<OllamaStatus> {
    const current = await this.status();
    if (current.running) return current;

    try {
      const child = spawn("ollama", ["serve"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, OLLAMA_MODELS: this.modelsDir },
      });
      child.unref();
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      // ignore
    }

    return this.status();
  }
}

export function createOllamaRuntime(options?: OllamaOptions): OllamaRuntime {
  return new OllamaRuntime(options);
}
