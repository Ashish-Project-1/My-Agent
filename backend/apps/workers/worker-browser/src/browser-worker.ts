import { type Browser, type BrowserContext, chromium } from "playwright";

export interface BrowserTask {
  url: string;
  action: "navigate" | "screenshot" | "extract";
  allowDomains?: string[];
  denyDomains?: string[];
}

function isDomainAllowed(url: string, allow?: string[], deny?: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    if (deny?.some((d) => host === d || host.endsWith(`.${d}`))) {
      return false;
    }
    if (allow && allow.length > 0) {
      return allow.some((d) => host === d || host.endsWith(`.${d}`));
    }
    return true;
  } catch {
    return false;
  }
}

export class BrowserWorker {
  private browser: Browser | null = null;

  async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async runTask(task: BrowserTask): Promise<{ ok: boolean; reason?: string; screenshot?: string }> {
    if (!isDomainAllowed(task.url, task.allowDomains, task.denyDomains)) {
      return { ok: false, reason: "domain_not_allowed" };
    }
    const browser = await this.ensureBrowser();
    // Isolated context per task, no shared cookies
    const context: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: false });
    try {
      const page = await context.newPage();
      await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (task.action === "screenshot") {
        const buf = await page.screenshot({ fullPage: true });
        return { ok: true, screenshot: buf.toString("base64") };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.message ?? "unknown" };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
