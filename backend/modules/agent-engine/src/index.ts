/**
 * `@ua/agent-engine` — the task state machine and the agent loop
 * (docs/planning/03 §5.7, 08).
 *
 * Depends on `@ua/contracts` only. No framework, no database, no I/O: the engine
 * decides *what is legal*, the API and workers decide when to ask.
 */
export * from "./action.js";
export * from "./loop.js";
export * from "./policy.js";
export * from "./task-state.js";
export * from "./tools.js";
export * from "./verification.js";
