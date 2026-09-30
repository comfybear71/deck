/**
 * The Sunnybank "Render N lines" loop, as a small pure runner
 * (2026-09-30), so Stop can be tested. One line at a time, in order:
 * lines that are already Done are skipped, a failed line halts the run
 * (later lines are never billed), and Stop is checked before each new
 * line starts. The line that is already rendering is never cut off: it
 * finishes and saves, then the run ends.
 *
 * Same idea as Music video's `shouldStop` in `lib/scriptSequenceRunner.ts`.
 */
export type SunnyBanksRenderQueueOutcome =
  | { outcome: "finished"; rendered: number }
  /** Stop was tapped; `index` is the first line that was not started. */
  | { outcome: "stopped"; rendered: number; index: number }
  /** A line failed (or couldn't start); `index` is that line. */
  | { outcome: "halted"; rendered: number; index: number };

export async function runSunnyBanksRenderQueue<T>(
  items: readonly T[],
  opts: {
    /** Already Done: no charge, no check for Stop. */
    skip: (item: T, index: number) => boolean;
    /** Read before each new line starts. */
    shouldStop: () => boolean;
    /** Renders and saves one line. `false` = it failed, so stop here. */
    render: (item: T, index: number) => Promise<boolean>;
  },
): Promise<SunnyBanksRenderQueueOutcome> {
  let rendered = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (opts.skip(items[i], i)) continue;
    if (opts.shouldStop()) return { outcome: "stopped", rendered, index: i };
    const ok = await opts.render(items[i], i);
    if (!ok) return { outcome: "halted", rendered, index: i };
    rendered += 1;
  }
  return { outcome: "finished", rendered };
}

/** The line under the Render button after a Stop. */
export function sunnyBanksStoppedText(index: number): string {
  return `Stopped before line ${index + 1} — later lines were not billed.`;
}
