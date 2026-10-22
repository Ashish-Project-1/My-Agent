import type { NextConfig } from "next";

// The API's own address, only ever used by the server-side rewrite. Defaults to
// the API's default port; override when that port is taken by something else.
// The browser never sees this URL — it only ever talks to this app's own origin,
// which is what keeps the session cookie first-party and lets the API run with
// no CORS at all (docs/planning/12 §4 "Security boundary").
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  /**
   * `next dev` blocks its own dev-only endpoints from any hostname it was not
   * started with, and a blocked HMR client is not a cosmetic warning: the app
   * never hydrates, so every page sits on "Loading…" forever. The dev server
   * allows `localhost` already; this adds the other name localhost goes by.
   * Ignored outside development.
   */
  allowedDevOrigins: ["127.0.0.1"],
  // Every `/v1/...` request is forwarded to the API. The browser therefore
  // believes it is same-origin, which is what lets the HttpOnly session cookie
  // and the double-submit CSRF cookie work without a CORS preflight
  // (docs/planning/12 §4 "Security boundary").
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` }];
  },
};

export default nextConfig;
