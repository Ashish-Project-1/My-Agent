import { afterEach, describe, expect, it, vi } from "vitest";
import { followTaskEvents, type TaskStreamHandlers } from "../src/lib/sse";

/**
 * Exercises `followTaskEvents`, the reconnect loop — the part of the SSE client
 * that holds state (`lastEventId`, `finished`) and can only be reached by
 * driving timers, which is why it is a separate file from the pure parser tests
 * in `sse.test.ts`.
 */

const encoder = new TextEncoder();

/** A response whose body is a queue of chunks that ends once drained. */
function streamResponse(status: number, chunks: string[]): Response {
  let index = 0;
  const body = {
    getReader() {
      return {
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        cancel: async (): Promise<void> => {},
      };
    },
  };
  return { status, ok: status >= 200 && status < 300, body } as unknown as Response;
}

function eventFrame(seq: number, type: string, id = `t:${seq}`): string {
  return `id: ${id}\nevent: ${type}\ndata: {"seq":${seq},"type":"${type}","taskId":"t"}\n\n`;
}

const DONE_FRAME = 'id: t:9\nevent: done\ndata: {"state":"COMPLETED"}\n\n';

/** Lets the loop's `await fetch(...)` chain settle without advancing timers. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function handlers(overrides: Partial<TaskStreamHandlers> = {}): TaskStreamHandlers {
  return {
    onEvent: vi.fn(),
    onResync: vi.fn(),
    onDone: vi.fn(),
    onSignedOut: vi.fn(),
    onStatus: vi.fn(),
    ...overrides,
  } as TaskStreamHandlers;
}

describe("followTaskEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stops on 401 and hands the page its signed-out path", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => streamResponse(401, []));
    vi.stubGlobal("fetch", fetchMock);

    const handle = handlers();
    followTaskEvents("t", handle);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handle.onSignedOut).toHaveBeenCalledTimes(1);
    expect(handle.onStatus).toHaveBeenLastCalledWith("ended");
  });

  it("stops on a 404 without retrying a task it may never read", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => streamResponse(404, []));
    vi.stubGlobal("fetch", fetchMock);

    const handle = handlers();
    followTaskEvents("t", handle);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handle.onSignedOut).not.toHaveBeenCalled();
    expect(handle.onStatus).toHaveBeenLastCalledWith("ended");
  });

  it("retries a 500, replays the stream, and ends on the done frame", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(500, []))
      .mockResolvedValueOnce(streamResponse(200, [eventFrame(1, "task.created"), DONE_FRAME]));
    vi.stubGlobal("fetch", fetchMock);

    const handle = handlers();
    followTaskEvents("t", handle);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handle.onEvent).toHaveBeenCalledTimes(1);
    expect((handle.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      seq: 1,
    });
    expect(handle.onDone).toHaveBeenCalledWith("COMPLETED");
    expect(handle.onStatus).toHaveBeenLastCalledWith("ended");
  });

  it("resumes from the last id the server gave it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(500, []))
      // One frame, then the socket drops without a done frame.
      .mockResolvedValueOnce(streamResponse(200, [eventFrame(7, "task.created")]))
      .mockResolvedValueOnce(streamResponse(404, []));
    vi.stubGlobal("fetch", fetchMock);

    followTaskEvents("t", handlers());
    await vi.advanceTimersByTimeAsync(5000);

    const [, second, third] = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit | undefined]
    >;
    expect(second[1]?.headers ?? {}).not.toHaveProperty("last-event-id");
    expect(third[1]?.headers).toMatchObject({ "last-event-id": "t:7" });
  });

  it("does not announce a connection that the caller aborted first", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => streamResponse(500, []));
    vi.stubGlobal("fetch", fetchMock);

    const handle = handlers();
    const stop = followTaskEvents("t", handle);
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handle.onStatus).not.toHaveBeenCalledWith("ended");
  });
});
