import { describe, expect, it } from "vitest";
import { requestContext } from "../src/common/request-context.js";

describe("requestContext", () => {
  it("honours valid inbound values", () => {
    const rc = requestContext({
      "x-request-id": "01HJWQX3Z4F3V4X3Z4F3V4X3Z4",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(rc.requestId).toBe("01HJWQX3Z4F3V4X3Z4F3V4X3Z4");
    expect(rc.traceId).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });

  it("ignores invalid values and generates new ones", () => {
    const rc = requestContext({
      "x-request-id": "not-a-ulid",
      traceparent: "00-00000000000000000000000000000000-0000000000000000-01",
    });
    expect(rc.requestId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(rc.traceId).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it("treats array headers as absent", () => {
    const rc = requestContext({
      "x-request-id": ["01HJWQX3Z4F3V4X3Z4F3V4X3Z4"],
      traceparent: ["00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"],
    });
    expect(rc.requestId).not.toBe("01HJWQX3Z4F3V4X3Z4F3V4X3Z4");
    expect(rc.traceId).not.toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });
});
