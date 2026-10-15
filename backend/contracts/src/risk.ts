import { z } from "zod";

/**
 * Risk classes R0–R4 (docs/planning/10 §2). Risk is a property of the concrete
 * action, not of the tool, so a class is assigned per step argument set.
 *
 * R4 is prohibited regardless of what a user or model asks for, and cannot be
 * loosened by policy — the engine refuses it before any executor sees it.
 */
export const RISK_CLASSES = ["R0", "R1", "R2", "R3", "R4"] as const;

export type RiskClass = (typeof RISK_CLASSES)[number];
export const RiskClass = z.enum(RISK_CLASSES);

/** Higher is more dangerous; used for the "highest class seen" task warning (08 §2.1). */
export function riskRank(riskClass: RiskClass): number {
  return RISK_CLASSES.indexOf(riskClass);
}
