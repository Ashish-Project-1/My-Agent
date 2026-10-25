import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface DocumentTask {
  filename: string;
  content: Buffer | string;
  mimeType?: string;
}

export class DocumentWorker {
  private artifactsDir: string;

  constructor(artifactsDir: string = "./artifacts") {
    this.artifactsDir = artifactsDir;
  }

  async ingest(task: DocumentTask): Promise<{ artifactId: string; path: string; size: number }> {
    await mkdir(this.artifactsDir, { recursive: true });
    const artifactId = randomUUID();
    const ext = task.filename.split(".").pop() || "bin";
    const path = join(this.artifactsDir, `${artifactId}.${ext}`);
    const data = typeof task.content === "string" ? Buffer.from(task.content) : task.content;
    await writeFile(path, data);
    return { artifactId, path, size: data.length };
  }
}
