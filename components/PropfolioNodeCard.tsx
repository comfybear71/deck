"use client";

import type { PropfolioData } from "@/lib/types";
import { HEALTH_META, formatCount } from "@/lib/propfolio";

interface PropfolioNodeCardProps {
  data: PropfolioData;
  onOpen: () => void;
}

/**
 * Propfolio's node face — a health/error status glance, not a portfolio
 * dashboard. Shows only: the name, client + property counts (TBD dashes
 * until live data lands), a big status chip (ok/error/unknown), and — when
 * there's an error — a short one-line blurb plus a red ring around the
 * whole card, so Stuart sees the problem without opening the full app.
 * Tapping opens PropfolioDetailSheet.
 */
export function PropfolioNodeCard({ data, onOpen }: PropfolioNodeCardProps) {
  const meta = HEALTH_META[data.status];
  const isError = data.status === "error";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Propfolio — health status ${meta.label}${
        isError && data.errorMessage ? `. ${data.errorMessage}` : ""
      }. ${formatCount(data.clientCount)} clients, ${formatCount(
        data.propertyCount
      )} properties. Open details.`}
      className={[
        "group relative flex w-full min-h-16 items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-colors active:scale-[0.99]",
        isError
          ? "border-rose-500/50 bg-rose-500/[0.06] shadow-[0_0_30px_-10px_rgba(244,63,94,0.5)] hover:bg-rose-500/[0.1]"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
      ].join(" ")}
    >
      {isError && (
        <span
          aria-hidden
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.7)]"
        />
      )}

      <span
        aria-hidden
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold",
          isError ? "bg-rose-500/15 text-rose-300" : "bg-white/10 text-white/60",
        ].join(" ")}
      >
        P
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-white">
          Propfolio
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
          Project
          <span aria-hidden>·</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chipClass}`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
            {meta.label}
          </span>
        </span>
        <span className="mt-1.5 flex items-center gap-3 text-[11px] tabular-nums text-white/50">
          <span>
            <span className="font-semibold text-white/80">
              {formatCount(data.clientCount)}
            </span>{" "}
            clients
          </span>
          <span>
            <span className="font-semibold text-white/80">
              {formatCount(data.propertyCount)}
            </span>{" "}
            properties
          </span>
        </span>

        {isError && data.errorMessage && (
          <span className="mt-1 block truncate text-xs text-rose-300/90">
            {data.errorMessage}
          </span>
        )}
      </span>

      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M7.5 4l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
