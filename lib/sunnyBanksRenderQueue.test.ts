import { describe, expect, it } from "vitest";
import { runSunnyBanksRenderQueue, sunnyBanksStoppedText } from "./sunnyBanksRenderQueue";

/** Stop next to Render (2026-09-30): the line that's rendering finishes
 * and saves; nothing after it starts, so nothing after it is billed. */
describe("runSunnyBanksRenderQueue", () => {
  const rows = ["a", "b", "c", "d"];

  it("renders every line that isn't Done, in order", async () => {
    const started: string[] = [];
    const out = await runSunnyBanksRenderQueue(rows, {
      skip: (r) => r === "b",
      shouldStop: () => false,
      render: async (r) => {
        started.push(r);
        return true;
      },
    });
    expect(started).toEqual(["a", "c", "d"]);
    expect(out).toEqual({ outcome: "finished", rendered: 3 });
  });

  it("Stop tapped during a line: that line finishes and saves, the next never starts", async () => {
    let stop = false;
    const saved: string[] = [];
    const started: string[] = [];
    const out = await runSunnyBanksRenderQueue(rows, {
      skip: () => false,
      shouldStop: () => stop,
      render: async (r) => {
        started.push(r);
        if (r === "b") stop = true; // tapped while b renders
        await new Promise((res) => setTimeout(res, 5));
        saved.push(r);
        return true;
      },
    });
    expect(started).toEqual(["a", "b"]);
    expect(saved).toEqual(["a", "b"]);
    expect(out).toEqual({ outcome: "stopped", rendered: 2, index: 2 });
    expect(sunnyBanksStoppedText(out.outcome === "stopped" ? out.index : -1)).toBe(
      "Stopped before line 3 — later lines were not billed.",
    );
  });

  it("Stop during the last line to render just finishes", async () => {
    let stop = false;
    const out = await runSunnyBanksRenderQueue(rows, {
      skip: (r) => r === "d",
      shouldStop: () => stop,
      render: async (r) => {
        if (r === "c") stop = true;
        return true;
      },
    });
    expect(out).toEqual({ outcome: "finished", rendered: 3 });
  });

  it("a failed line halts the run, same as before", async () => {
    const started: string[] = [];
    const out = await runSunnyBanksRenderQueue(rows, {
      skip: () => false,
      shouldStop: () => false,
      render: async (r) => {
        started.push(r);
        return r !== "b";
      },
    });
    expect(started).toEqual(["a", "b"]);
    expect(out).toEqual({ outcome: "halted", rendered: 1, index: 1 });
  });
});
