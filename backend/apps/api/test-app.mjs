import { createApp } from "./dist/app.js";
import { loadConfig } from "./dist/config.js";

console.log("Loading config...");
const config = loadConfig();
console.log("Config loaded. Creating app...");

try {
  const app = await createApp(config);
  console.log("App created successfully!");
  console.log("Enabling shutdown hooks...");
  await app.enableShutdownHooks();
  console.log("Starting to listen on", config.host, ":", config.port);
  await app.listen({ port: config.port, host: config.host });
  console.log("API is running!");
} catch (error) {
  console.error("Error creating or starting app:", error);
  console.error(error.stack);
  process.exit(1);
}
