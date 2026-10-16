import { Module } from "@nestjs/common";
import { IdentityRepository } from "./identity.repository.js";

/** Exported so the global `AuthGuard`, which lives with the other HTTP plumbing, can use it. */
@Module({ providers: [IdentityRepository], exports: [IdentityRepository] })
export class IdentityModule {}
