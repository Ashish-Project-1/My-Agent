import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

async function main(): Promise<void> {
  const app = await createApp(config);
  await app.enableShutdownHooks();
  await app.listen({ port: config.port, host: config.host });
}

void main();
