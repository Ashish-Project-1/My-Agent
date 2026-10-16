import { CSRF_COOKIE, REFRESH_COOKIE, SESSION_COOKIE } from "@ua/contracts";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import type { IssuedSession } from "./auth.service.js";

const SESSION_PATH = "/";
/** Nothing but the auth endpoints ever presents the refresh token, so nothing else receives it. */
const REFRESH_PATH = "/v1/auth";

function baseOptions(config: AppConfig): {
  secure: boolean;
  sameSite: "lax";
  domain?: string;
} {
  return {
    secure: config.cookieSecure,
    // Lax, not Strict: a link from an email into the app should already be
    // signed in. The CSRF token is what actually stops a forged request, and it
    // works on the unsafe methods where Lax alone would not
    // (docs/planning/11 §5 "CSRF posture").
    sameSite: "lax",
    ...(config.cookieDomain === undefined ? {} : { domain: config.cookieDomain }),
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  issued: IssuedSession,
): void {
  reply.setCookie(SESSION_COOKIE, issued.sessionToken, {
    ...baseOptions(config),
    httpOnly: true,
    path: SESSION_PATH,
    maxAge: issued.sessionMaxAgeSeconds,
  });

  reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
    ...baseOptions(config),
    httpOnly: true,
    path: REFRESH_PATH,
    maxAge: issued.refreshMaxAgeSeconds,
  });

  // Readable by the page on purpose: the double-submit value has to be echoed in
  // a header, and a script can only do that if it can read the cookie. It carries
  // no authority on its own — the guard checks it against the session.
  reply.setCookie(CSRF_COOKIE, issued.csrfToken, {
    ...baseOptions(config),
    httpOnly: false,
    path: SESSION_PATH,
    maxAge: issued.sessionMaxAgeSeconds,
  });
}

/** Clears all three, so a signed-out browser keeps no half of the pair. */
export function clearSessionCookies(reply: FastifyReply, config: AppConfig): void {
  for (const [name, path] of [
    [SESSION_COOKIE, SESSION_PATH],
    [REFRESH_COOKIE, REFRESH_PATH],
    [CSRF_COOKIE, SESSION_PATH],
  ] as const) {
    reply.clearCookie(name, { ...baseOptions(config), path });
  }
}
