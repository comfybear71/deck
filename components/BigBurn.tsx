import { formatMoney, glowIntensity } from "@/lib/meters";

interface BigBurnProps {
  burnUSD: number;
  burnAUD: number;
  /** e.g. "Last 30 days" — see `lib/spend-window.ts`'s `windowLabel`. */
  windowLabel: string;
  /** The soft leash goal, prorated to the same window as `burnUSD`. */
  goalUSD: number;
}

export function BigBurn({ burnUSD, burnAUD, windowLabel, goalUSD }: BigBurnProps) {
  const intensity = glowIntensity(burnUSD, goalUSD);
  const overGoal = burnUSD > goalUSD;

  return (
    <div className="relative flex flex-col items-center py-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-[opacity,transform] duration-700"
        style={{
          width: 340,
          height: 340,
          opacity: intensity,
          background: overGoal
            ? "radial-gradient(circle, rgba(244,63,94,0.55), transparent 70%)"
            : "radial-gradient(circle, rgba(96,165,250,0.45), transparent 70%)",
          transform: `translate(-50%, -50%) scale(${0.85 + intensity * 0.5})`,
        }}
      />

      <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/40">
        {windowLabel} burn
      </p>
      <p className="mt-2 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
        {formatMoney(burnUSD, "USD")}
      </p>
      <p className="mt-1 text-xs text-white/40">
        {overGoal ? "over" : "under"} the {formatMoney(goalUSD, "USD")} leash goal
        for this window
      </p>
      {burnAUD > 0 && (
        <p className="mt-3 text-xs text-white/35">
          + {formatMoney(burnAUD, "AUD")} AUD kept separate
        </p>
      )}
    </div>
  );
}
