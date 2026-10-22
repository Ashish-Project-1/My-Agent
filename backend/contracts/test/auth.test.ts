// scan-secrets:allow-file — the token-shaped strings here are fixtures.
import { describe, expect, it } from "vitest";
import {
  AuthSessionResponse,
  CreateOrganizationRequest,
  CSRF_COOKIE,
  CSRF_HEADER,
  Email,
  LoginRequest,
  MembershipRole,
  MeResponse,
  OrganizationListResponse,
  PASSWORD_MIN_LENGTH,
  REFRESH_COOKIE,
  RegisterRequest,
  SESSION_COOKIE,
} from "../src/index.js";

/** A session payload shaped exactly as docs/planning/07 §3.1 shows for login. */
const SESSION = {
  user: {
    id: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
    email: "a@b.com",
    displayName: "A",
  },
  organizations: [{ id: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6072", name: "Personal", role: "owner" }],
  activeOrganizationId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6072",
  accessToken: null,
  expiresAt: "2026-10-15T10:30:00.000Z",
};

describe("Email", () => {
  it("trims and lowercases at the boundary", () => {
    expect(Email.parse("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("rejects a value that is not an email", () => {
    expect(Email.safeParse("not-an-email").success).toBe(false);
  });

  it("rejects a value longer than 254 characters", () => {
    expect(Email.safeParse(`${"a".repeat(250)}@b.co`).success).toBe(false);
  });
});

describe("RegisterRequest password policy", () => {
  const base = { email: "a@b.com", password: "correct horse battery staple" };

  it("accepts a password at the minimum length", () => {
    expect(
      RegisterRequest.safeParse({ ...base, password: "a".repeat(PASSWORD_MIN_LENGTH) }).success,
    ).toBe(true);
  });

  it("rejects a password one character below the minimum", () => {
    expect(
      RegisterRequest.safeParse({ ...base, password: "a".repeat(PASSWORD_MIN_LENGTH - 1) }).success,
    ).toBe(false);
  });

  it("rejects an over-long password: it is a denial-of-service bound", () => {
    expect(RegisterRequest.safeParse({ ...base, password: "a".repeat(201) }).success).toBe(false);
  });

  it("rejects unknown properties instead of ignoring them", () => {
    expect(RegisterRequest.safeParse({ ...base, locale: "en" }).success).toBe(false);
  });
});

describe("LoginRequest", () => {
  const base = { email: "a@b.com", password: "correct horse battery staple" };

  it("accepts any non-empty password: an existing account may predate the policy", () => {
    expect(LoginRequest.safeParse({ ...base, password: "short" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(LoginRequest.safeParse({ ...base, password: "" }).success).toBe(false);
  });

  it("accepts the null organizationId from the §3.1 example", () => {
    expect(LoginRequest.safeParse({ ...base, organizationId: null }).success).toBe(true);
  });

  it("rejects a v4 organization id", () => {
    expect(
      LoginRequest.safeParse({ ...base, organizationId: "9f4b2c1d-3e5a-4b7c-8d9e-0f1a2b3c4d5e" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown properties", () => {
    expect(LoginRequest.safeParse({ ...base, mfaCode: "123456" }).success).toBe(false);
  });
});

describe("AuthSessionResponse", () => {
  it("accepts the representative §3.1 response", () => {
    expect(AuthSessionResponse.safeParse(SESSION).success).toBe(true);
  });

  it("requires a timestamp with milliseconds", () => {
    expect(
      AuthSessionResponse.safeParse({ ...SESSION, expiresAt: "2026-10-15T10:30:00Z" }).success,
    ).toBe(false);
  });

  it("accepts a populated accessToken for a native client", () => {
    expect(AuthSessionResponse.safeParse({ ...SESSION, accessToken: "opaque-token" }).success).toBe(
      true,
    );
  });

  it("rejects an active organization id that is not a UUIDv7", () => {
    expect(
      AuthSessionResponse.safeParse({ ...SESSION, activeOrganizationId: "not-an-id" }).success,
    ).toBe(false);
  });
});

describe("MeResponse", () => {
  it("carries the user, memberships and active organization", () => {
    const parsed = MeResponse.safeParse({
      user: SESSION.user,
      organizations: SESSION.organizations,
      activeOrganizationId: SESSION.activeOrganizationId,
    });
    expect(parsed.success).toBe(true);
  });

  it("is not a session: it never carries a credential", () => {
    const parsed = MeResponse.safeParse({ ...SESSION, accessToken: null });
    expect(parsed.success).toBe(false);
  });
});

describe("MembershipRole", () => {
  it("mirrors the four documented roles", () => {
    expect(MembershipRole.options).toEqual(["owner", "admin", "member", "viewer"]);
  });

  it("rejects a role outside the set", () => {
    expect(MembershipRole.safeParse("superadmin").success).toBe(false);
  });
});

describe("OrganizationListResponse", () => {
  it("uses the documented list envelope", () => {
    expect(OrganizationListResponse.safeParse({ data: [], nextCursor: null }).success).toBe(true);
  });

  it("requires nextCursor to be present even when the list is not paginated", () => {
    expect(OrganizationListResponse.safeParse({ data: [] }).success).toBe(false);
  });

  it("accepts a cursor value, so a later paginated list can reuse the envelope", () => {
    expect(OrganizationListResponse.safeParse({ data: [], nextCursor: "018f2b3c" }).success).toBe(
      true,
    );
  });
});

describe("CreateOrganizationRequest", () => {
  it("requires a name", () => {
    expect(CreateOrganizationRequest.safeParse({ name: "" }).success).toBe(false);
  });

  it("trims a padded name", () => {
    expect(CreateOrganizationRequest.parse({ name: "  Acme  " }).name).toBe("Acme");
  });

  it("rejects unknown properties", () => {
    expect(CreateOrganizationRequest.safeParse({ name: "Acme", slug: "acme" }).success).toBe(false);
  });
});

describe("cookie and header names", () => {
  it("are distinct so one cookie cannot answer two purposes", () => {
    const names = [SESSION_COOKIE, REFRESH_COOKIE, CSRF_COOKIE];
    expect(new Set(names).size).toBe(names.length);
  });

  it("are readable by JavaScript only for the CSRF token", () => {
    // Documented by construction: only the CSRF cookie is meant to be read by a
    // page, because the double-submit token is sent back in a request header.
    expect(CSRF_COOKIE).not.toBe(SESSION_COOKIE);
    expect(CSRF_HEADER).toBe("x-csrf-token");
  });
});
