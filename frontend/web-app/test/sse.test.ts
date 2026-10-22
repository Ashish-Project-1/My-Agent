import type { TaskEventSummary } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import { createFrameParser, mergeEvents, type SseFrame } from "../src/lib/sse";

/** Collects every frame a stream produces, however the chunks arrived. */
function parser(): { frames: SseFrame[]; push: (chunk: string) => void } {
  const frames: SseFrame[] = [];
  return { frames, push: createFrameParser((frame) => frames.push(frame)) };
}

function event(seq: number, type: string): TaskEventSummary {
  return { seq, type, actor: "worker", data: null, createdAt: "2026-10-17T12:00:00.000Z" };
}

describe("createFrameParser", () => {
  it("reads an id, an event name and its data", () => {
    const { frames, push } = parser();

    push('id: 6f1c0a3e:3\nevent: step.started\ndata: {"seq":3}\n\n');

    expect(frames).toEqual([{ id: "6f1c0a3e:3", event: "step.started", data: '{"seq":3}' }]);
  });

  it("holds a frame whose chunk boundary falls inside it", () => {
    const { frames, push } = parser();

    push("id: task:7\nev");
    push("ent: plan.created\ndata: ");
    push('{"seq":7}');
    expect(frames).toHaveLength(0);

    push("\n\n");

    expect(frames).toEqual([{ id: "task:7", event: "plan.created", data: '{"seq":7}' }]);
  });

  it("drops a heartbeat comment but keeps a named frame that carries no data", () => {
    const { frames, push } = parser();

    push(":hb\n\n");
    push("event: resync\n\n");

    // `resync` has no data line; losing it would leave the page showing a
    // timeline that has a hole in it (docs/planning/07 §5).
    expect(frames).toEqual([{ event: "resync", data: "" }]);
  });

  it("rejoins multi-line data with newlines", () => {
    const { frames, push } = parser();

    push("event: task.completed\ndata: line one\ndata: line two\n\n");

    expect(frames).toEqual([{ event: "task.completed", data: "line one\nline two" }]);
  });

  it("emits every frame of a replayed history, in order", () => {
    const { frames, push } = parser();

    push('id: task:1\nevent: task.created\ndata: {"seq":1}\n\n');
    push('id: task:2\nevent: plan.created\ndata: {"seq":2}\n\n');
    push('event: done\ndata: {"state":"COMPLETED"}\n\n');

    expect(frames.map((frame) => frame.event)).toEqual(["task.created", "plan.created", "done"]);
  });
});

describe("mergeEvents", () => {
  it("orders by sequence", () => {
    const merged = mergeEvents(
      [event(3, "verification.passed"), event(1, "task.created")],
      [event(2, "plan.created")],
    );

    expect(merged.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("keeps one copy when a reconnect replays events already fetched", () => {
    const fetched = [event(1, "task.created"), event(2, "plan.created")];

    const merged = mergeEvents(fetched, fetched);

    expect(merged).toHaveLength(2);
    expect(merged).toEqual(fetched);
  });

  it("prefers the streamed copy, which is the one that carries fresh data", () => {
    const merged = mergeEvents(
      [{ ...event(1, "task.created"), data: null }],
      [{ ...event(1, "task.created"), data: { steps: 4 } }],
    );

    expect(merged).toEqual([{ ...event(1, "task.created"), data: { steps: 4 } }]);
  });
});
