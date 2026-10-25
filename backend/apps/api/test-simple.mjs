import { loadConfig } from "./dist/config.js";

console.log("Loading config...");
try {
  const config = loadConfig();
  console.log("Config loaded successfully:");
  console.log(JSON.stringify(config, null, 2));
} catch (error) {
  console.error("Error loading config:", error);
  process.exit(1);
}
