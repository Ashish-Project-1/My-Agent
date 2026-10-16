import { Injectable } from "@nestjs/common";
import type {
  CreateOrganizationRequest,
  OrganizationListResponse,
  OrganizationSummary,
} from "@ua/contracts";
import { AppError } from "@ua/error-handling";
// Value imports for injected classes: Nest resolves dependencies from decorator
// metadata, which a type-only import erases.
import { AuditService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import { isUniqueViolationOn } from "../common/prisma-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { slugCandidates } from "../common/slug.js";
import { IdentityRepository } from "../identity/identity.repository.js";

/**
 * Organizations (docs/planning/07 §3.2, 10).
 *
 * At present the API only creates personal/team orgs and lists the caller's
 * memberships. Other paths are deferred to later phases.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly audit: AuditService,
  ) {}

  async list(principal: Principal): Promise<OrganizationListResponse> {
    const organizations = await this.identity.listOrganizations(principal.userId);
    return {
      data: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        role: organization.role,
      })),
      nextCursor: null,
    };
  }

  async create(
    principal: Principal,
    input: CreateOrganizationRequest,
    meta: RequestMeta,
  ): Promise<OrganizationSummary> {
    const organizationName = input.name.trim();
    for (const slug of slugCandidates(organizationName)) {
      try {
        return await this.identity.transaction(async (writer) => {
          const organization = await this.identity.createOrganization(writer, {
            name: organizationName,
            slug,
            kind: "team",
          });

          await this.identity.createMembership(writer, {
            userId: principal.userId,
            organizationId: organization.id,
            role: "owner",
            invitedBy: principal.userId,
          });

          await this.audit.record(
            {
              organizationId: organization.id,
              actorType: "user",
              actorId: principal.userId,
              action: AUDIT_ACTIONS.organizationCreate,
              resourceType: "organization",
              resourceId: organization.id,
              ipHash: meta.ipHash,
              userAgentDigest: meta.userAgentDigest,
              traceId: meta.traceId,
            },
            writer,
          );

          return {
            id: organization.id,
            name: organization.name,
            role: "owner",
          };
        });
      } catch (error) {
        if (isUniqueViolationOn(error, "slug")) {
          // Another request claimed the slug between attempts — roll back and try
          // the next candidate.
          continue;
        }
        throw error;
      }
    }
    throw new AppError("conflict", "Could not allocate an organization name. Try again.");
  }

  /**
   * Return a membership summary for one org, or `null` if the caller is not a
   * member. The caller maps `null` to a 404 so as not to confirm that the org
   * exists (docs/planning/07 §1).
   */
  async findForMember(
    principal: Principal,
    organizationId: string,
  ): Promise<OrganizationSummary | null> {
    const membership = await this.identity.findOrganizationForMember(
      principal.userId,
      organizationId,
    );
    return membership === null
      ? null
      : { id: membership.id, name: membership.name, role: membership.role };
  }
}
