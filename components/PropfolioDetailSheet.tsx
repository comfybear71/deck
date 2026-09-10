"use client";

import { useEffect } from "react";
import type { PropfolioData, PropfolioProperty } from "@/lib/types";
import { HEALTH_META, formatCheckedAt, formatCount } from "@/lib/propfolio";

interface PropfolioDetailSheetProps {
  data: PropfolioData;
  onClose: () => void;
}

/**
 * Propfolio's detail sheet — opened by tapping the status node in the v0
 * graph (see PropfolioNodeCard). Status + error message, a client/property
 * count rollup with a one-line summary, a stub Properties list, and two
 * outbound links (app / repo). No login form, no real property CRUD —
 * fixing the underlying bug happens from Deck / Cursor separately, not
 * from this sheet.
 */
export function PropfolioDetailSheet({ data, onClose }: PropfolioDetailSheetProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const meta = HEALTH_META[data.status];
  const isError = data.status === "error";
  const hasUrl = data.url.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        className={[
          "relative z-10 max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl",
          "sm:max-w-md sm:rounded-3xl sm:p-6",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Propfolio details"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Propfolio</h2>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Health status
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          className={[
            "flex items-center gap-3 rounded-2xl border px-4 py-4",
            isError ? "border-rose-500/40 bg-rose-500/[0.06]" : "border-white/5 bg-white/[0.03]",
          ].join(" ")}
        >
          <span
            aria-hidden
            className={`flex h-3 w-3 shrink-0 rounded-full ${meta.dotClass}`}
          />
          <span
            className={`text-sm font-semibold uppercase tracking-wide ${
              isError ? "text-rose-300" : "text-white/70"
            }`}
          >
            {meta.label}
          </span>
        </div>

        {isError && data.errorMessage && (
          <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.05] px-3 py-2.5">
            <p className="text-sm text-rose-200">{data.errorMessage}</p>
            <p className="mt-1 text-[11px] text-rose-200/60">
              Reports on this have disagreed before (browser vs. automated
              checks) — treat this as the latest known status, not
              confirmed live.
            </p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-white/30">
          {formatCheckedAt(data.lastCheckedAt)}
        </p>

        {/* Client/property rollup */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="text-lg font-bold tabular-nums text-white">
              {formatCount(data.clientCount)}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Clients
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="text-lg font-bold tabular-nums text-white">
              {formatCount(data.propertyCount)}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Properties
            </p>
          </div>
        </div>

        {data.summary && (
          <p className="mt-2.5 text-xs leading-relaxed text-white/50">
            {data.summary}
          </p>
        )}

        {/* Properties list stub */}
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
            Properties
          </p>
          {data.properties.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-xs text-white/40">
              No property data yet — nothing to list until Propfolio&rsquo;s
              data syncs here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.properties.map((property) => (
                <PropertyRow key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/40">
          Fixing this happens from Deck / Cursor later, in the Propfolio
          repo — this sheet is a status glance only.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {hasUrl ? (
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/20 active:bg-white/25"
            >
              Open app
              <ExternalIcon />
            </a>
          ) : (
            <p className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-center text-xs text-white/40">
              Live app URL not set yet (TODO).
            </p>
          )}

          <a
            href={data.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.07] hover:text-white active:bg-white/[0.1]"
          >
            Open repo
            <ExternalIcon />
          </a>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({ property }: { property: PropfolioProperty }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
      <p className="truncate text-sm font-medium text-white">
        {property.address ?? "Address unknown"}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
        {property.clientName && <span>{property.clientName}</span>}
        {property.clientName && property.status && <span aria-hidden>·</span>}
        {property.status && <span>{property.status}</span>}
      </p>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M7.5 4h8.5v8.5M16 4L4 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
