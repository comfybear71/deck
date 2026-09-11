import type { BurnBucket } from "@/lib/spend-window";
import { formatMoney } from "@/lib/meters";

interface BurnGraphProps {
  buckets: BurnBucket[];
}

/**
 * Compact bar chart of the selected window's burn — daily bars for 7d,
 * weekly-ish bars for 30d (see `buildBurnSeries` in lib/spend-window.ts).
 * Plain inline SVG, no charting dependency: this is a handful of bars, not
 * a dashboard.
 */
export function BurnGraph({ buckets }: BurnGraphProps) {
  const max = Math.max(...buckets.map((b) => b.amountUSD), 1);

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
      <div className="flex h-28 items-end gap-1.5 sm:h-32">
        {buckets.map((bucket) => {
          const heightPct = Math.max(3, (bucket.amountUSD / max) * 100);
          return (
            <div
              key={bucket.startDate}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
            >
              <div
                className="absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg group-hover:block group-focus-visible:block"
                aria-hidden
              >
                {formatMoney(bucket.amountUSD, "USD")}
              </div>
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-sky-500/70 to-sky-300/80 transition-[height] duration-300"
                style={{ height: `${heightPct}%` }}
                role="img"
                aria-label={`${bucket.label}: ${formatMoney(bucket.amountUSD, "USD")}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {buckets.map((bucket) => (
          <span
            key={bucket.startDate}
            className="flex-1 truncate text-center text-[9px] uppercase tracking-wide text-white/35"
          >
            {bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}
