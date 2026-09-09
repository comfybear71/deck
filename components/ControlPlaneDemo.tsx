"use client";

import { useState } from "react";
import type { Suit } from "@/lib/types";
import { SUIT_META, SUIT_ORDER } from "@/lib/constants";
import { check, report, type CheckResult } from "@/lib/control-plane";

type LaneResult = CheckResult & { reportedAt?: number };

const RESULT_STYLE: Record<"allowed" | "throttled" | "denied", string> = {
  allowed: "bg-emerald-400/15 text-emerald-300",
  throttled: "bg-amber-400/15 text-amber-300",
  denied: "bg-rose-500/15 text-rose-300",
};

function resultKind(result: LaneResult): "allowed" | "throttled" | "denied" {
  if (!result.allowed) return "denied";
  return result.delayMs ? "throttled" : "allowed";
}

function resultLabel(result: LaneResult, pending: boolean): string {
  if (pending) return "throttling\u2026";
  const kind = resultKind(result);
  if (kind === "denied") return "denied";
  return kind === "throttled" ? "throttled \u00b7 sent" : "allowed \u00b7 sent";
}

/** Module-scope (not nested in the component) so the impure Math.random
 * call isn't attributed to component render purity checks. */
function randomSimulatedAmount(): number {
  return Math.round((Math.random() * 20 + 1) * 100) / 100;
}

/**
 * Expandable "feel the leash" panel — only rendered inside the expanded
 * TabCard. Per suit, "Simulate spend" calls check(lane) then, if allowed,
 * report(lane, amount). This is exactly the check\u2192report round trip a
 * real caller (Skidmarks / aiglitch-api) will make once wired up; see the
 * README's "Control plane (v0 stub)" section.
 */
export function ControlPlaneDemo() {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Partial<Record<Suit, LaneResult>>>({});
  const [pendingLane, setPendingLane] = useState<Suit | null>(null);

  const simulateSpend = async (suit: Suit) => {
    const result = check(suit);
    setResults((prev) => ({ ...prev, [suit]: result }));

    if (!result.allowed) return;

    setPendingLane(suit);
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }

    report(suit, randomSimulatedAmount(), { source: "demo-console" });

    setPendingLane(null);
    setResults((prev) => ({
      ...prev,
      [suit]: { ...result, reportedAt: Date.now() },
    }));
  };

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-wide text-white/40 transition-colors hover:text-white/60"
      >
        <span>Control-plane demo</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M5 7.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-white/40">
            &ldquo;Simulate spend&rdquo; runs the same check &rarr; report
            round trip a real caller will make: check(lane) first (pause
            denies, slow throttles, full allows), then report(lane, amount)
            once allowed.
          </p>

          {SUIT_ORDER.map((suit) => {
            const meta = SUIT_META[suit];
            const result = results[suit];
            const isPending = pendingLane === suit;

            return (
              <div
                key={suit}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <span aria-hidden className={`w-5 text-center text-sm ${meta.color}`}>
                  {meta.glyph}
                </span>
                <span className="flex-1 truncate text-xs text-white/70">
                  {meta.label}
                </span>
                <button
                  type="button"
                  onClick={() => simulateSpend(suit)}
                  disabled={isPending}
                  className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/20 active:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Simulate spend
                </button>
                {result && (
                  <span
                    title={result.reason}
                    className={[
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      RESULT_STYLE[resultKind(result)],
                    ].join(" ")}
                  >
                    {resultLabel(result, isPending)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
