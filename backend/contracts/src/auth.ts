import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";

/**
 * Identity and organization wire schemas (docs/planning/07 §3.1–§3.2).
 *
 * The password policy is stated here because it is a contract with the user:
 * length is the only complexity rule (NIST SP 800-63B), and the upper bound
 * exists so a multi-megabyte password cannot be used to burn Argon2 CPU. The
 * Argon2id parameters are not part of the contract — they are server-side and
 * may be re-tuned without a version bump (docs/planning/11 §5).
 */
export const EMAIL_MAX_LENGTH = 254; // RFC 5321 forward-path limit
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const DISPLAY_NAME_MAX_LENGTH = 80;

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, `must be at most ${EMAIL_MAX_LENGTH} characters`)
  // The format check lives on the pipe's output side, so `z.toJSONSchema` with
  // `io: "input"` would not carry `format: "email"` to the document; the meta
  // block puts it back where a client generator needs it.
  .meta({ format: "email" })
  .pipe(z.email("must be a valid email address"));
export type Email = z.infer<typeof Email>;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`);

/**
 * A password being *presented*, not chosen: sign-in must not apply the sign-up
 * policy, because an account created before a policy change would otherwise get
 * a validation error instead of the same generic rejection a wrong password
 * gets. The upper bound still applies — it is a denial-of-service bound, not a
 * policy (docs/planning/11 §5).
 */
export const PasswordAttempt = z
  .string()
  .min(1, "is required")
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`);

/** Mirrors the `MembershipRole` enum (docs/planning/06 §2.1). */
export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const MembershipRole = z.enum(MEMBERSHIP_ROLES);

/** Mirrors the `OrgKind` enum. Sign-up always creates a `personal` org. */
export const ORGANIZATION_KINDS = ["personal", "team"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
export const OrganizationKind = z.enum(ORGANIZATION_KINDS);

/** The org list on a session response carries only what a switcher needs (07 §3.1). */
export const OrganizationSummary = z
  .object({
    id: Uuid,
    name: z.string().min(1),
    role: MembershipRole,
  })
  .strict();
export type OrganizationSummary = z.infer<typeof OrganizationSummary>;

export const UserProfile = z
  .object({
    id: Uuid,
    email: Email,
    displayName: z.string().nullable(),
  })
  .strict();
export type UserProfile = z.infer<typeof UserProfile>;

export const RegisterRequest = z
  .object({
    email: Email,
    password: Password,
    displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z
  .object({
    email: Email,
    password: PasswordAttempt,
    /**
     * The organization the session starts in. Omitted or null selects the
     * personal org. A user who is not a member of the named org gets the same
     * rejection as a bad password (07 §1 "Authorisation": a foreign id never
     * confirms its own existence).
     */
    organizationId: Uuid.nullish(),
    deviceName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Sign-in and refresh both answer with this: the credential itself is a cookie,
 * so `accessToken` is null for web clients and is only populated for a
 * first-party native client (07 §1 "Auth").
 */
export const AuthSessionResponse = z
  .object({
    user: UserProfile,
    organizations: z.array(OrganizationSummary),
    activeOrganizationId: Uuid,
    accessToken: z.string().nullable(),
    expiresAt: Timestamp,
  })
  .strict();
export type AuthSessionResponse = z.infer<typeof AuthSessionResponse>;

export const MeResponse = z
  .object({
    user: UserProfile,
    organizations: z.array(OrganizationSummary),
    activeOrganizationId: Uuid,
  })
  .strict();
export type MeResponse = z.infer<typeof MeResponse>;

/** Email verification request. */
export const VerifyEmailRequest = z
  .object({
    token: z.string().min(1),
  })
  .strict();
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>;

/** Resend email verification request. */
export const ResendVerificationRequest = z
  .object({
    email: Email,
  })
  .strict();
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequest>;

/** Forgot password request (always returns 202 regardless of whether account exists). */
export const ForgotPasswordRequest = z
  .object({
    email: Email,
  })
  .strict();
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

/** Reset password request. */
export const ResetPasswordRequest = z
  .object({
    token: z.string().min(1),
    password: Password,
  })
  .strict();
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const CreateOrganizationRequest = z
  .object({
    name: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  })
  .strict();
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

/**
 * Memberships per user are bounded by design, so this list is not paginated: the
 * convention's keyset shape (07 §1 "Pagination") arrives with the lists that can
 * actually grow. `nextCursor` is present and always null so a client written
 * against the convention does not have to special-case it.
 */
export const OrganizationListResponse = z
  .object({
    data: z.array(OrganizationSummary),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type OrganizationListResponse = z.infer<typeof OrganizationListResponse>;

/**
 * Cookie and header names are part of the wire contract: the browser needs to
 * know which cookie to echo, and the value must not be HttpOnly for the
 * double-submit to work (07 §1 "Auth").
 */
export const SESSION_COOKIE = "ua_session";
export const REFRESH_COOKIE = "ua_refresh";
export const CSRF_COOKIE = "ua_csrf";
export const CSRF_HEADER = "x-csrf-token";
