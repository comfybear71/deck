"use client";

import { useEffect, useRef, useState } from "react";
import type { PropfolioData, PropfolioProperty } from "@/lib/types";
import {
  HEALTH_META,
  PAYSLIP_ONLY_SETUP_NOTE,
  PROPFOLIO_APP_URL,
  formatCheckedAt,
  formatCount,
  statusOneLiner,
} from "@/lib/propfolio";
import { copyToClipboard } from "@/lib/clipboard";
import { ActionChips, type ActionChipItem } from "./ActionChips";
import { AskGrokPanel } from "./AskGrokPanel";

interface PropfolioDetailSheetProps {
  data: PropfolioData;
  onClose: () => void;
}

const CHIP_FEEDBACK_TIMEOUT_MS = 3000;

/**
 * Propfolio's detail sheet — opened by tapping the status node in the v0
 * graph (see PropfolioNodeCard). Status + status note, a client/property
 * count rollup with a one-line summary, a stub Properties list, action
 * chips (open app, refresh health, payslip-only setup note, copy status),
 * an Ask Grok composer, and two outbound links (app / repo). No login
 * form, no real property CRUD — fixing anything found here happens from
 * Deck / Cursor separately, not from this sheet.
 */
export function PropfolioDetailSheet({ data, onClose }: PropfolioDetailSheetProps) {
  const [liveData, setLiveData] = useState(data);
  const [refreshing, setRefreshing] = useState(false);
  const [chipMessage, setChipMessage] = useState<string | null>(null);
  const chipMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (chipMessageTimer.current) clearTimeout(chipMessageTimer.current);
    };
  }, []);

  const showChipMessage = (message: string) => {
    if (chipMessageTimer.current) clearTimeout(chipMessageTimer.current);
    setChipMessage(message);
    chipMessageTimer.current = setTimeout(
      () => setChipMessage(null),
      CHIP_FEEDBACK_TIMEOUT_MS
    );
  };

  const meta = HEALTH_META[liveData.status];
  const { accent } = meta;
  const hasUrl = liveData.url.trim().length > 0;
  const appUrl = hasUrl ? liveData.url : PROPFOLIO_APP_URL;

  const handleOpenPropfolio = () => {
    window.open(appUrl, "_blank", "noopener,noreferrer");
    showChipMessage("Opened Propfolio in a new tab.");
  };

  const handleRefreshHealth = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/health/propfolio", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const next = (await res.json()) as PropfolioData;
      setLiveData(next);
      showChipMessage(`Refreshed \u2014 ${HEALTH_META[next.status].label}.`);
    } catch {
      showChipMessage("Refresh failed \u2014 try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const handlePayslipSetup = async () => {
    window.open(appUrl, "_blank", "noopener,noreferrer");
    const copied = await copyToClipboard(PAYSLIP_ONLY_SETUP_NOTE);
    showChipMessage(
      copied
        ? "Setup note copied + Propfolio opened."
        : "Propfolio opened \u2014 copy failed, note shown below."
    );
  };

  const handleCopyStatus = async () => {
    const oneLiner = statusOneLiner(liveData);
    const copied = await copyToClipboard(oneLiner);
    showChipMessage(copied ? "Status copied to clipboard." : `Copy failed \u2014 ${oneLiner}`);
  };

  const actionChips: ActionChipItem[] = [
    { id: "open", label: "Open Propfolio", onSelect: handleOpenPropfolio },
    {
      id: "refresh",
      label: "Refresh health",
      pendingLabel: "Refreshing\u2026",
      pending: refreshing,
      onSelect: handleRefreshHealth,
    },
    {
      id: "payslip-setup",
      label: "Payslip-only setup",
      onSelect: handlePayslipSetup,
    },
    { id: "copy-status", label: "Copy status", onSelect: handleCopyStatus },
  ];

  const askGrokSnapshot = {
    status: liveData.status,
    statusNote: liveData.statusNote,
    clientCount: liveData.clientCount,
    propertyCount: liveData.propertyCount,
    summary: liveData.summary,
    lastCheckedAt: liveData.lastCheckedAt,
  };

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
          className={`flex items-center gap-3 rounded-2xl border px-4 py-4 ${accent.noteBoxClass}`}
        >
          <span
            aria-hidden
            className={`flex h-3 w-3 shrink-0 rounded-full ${meta.dotClass}`}
          />
          <span
            className={`text-sm font-semibold uppercase tracking-wide ${accent.noteTextClass}`}
          >
            {meta.label}
          </span>
        </div>

        {liveData.statusNote && (
          <div className={`mt-3 rounded-xl border px-3 py-2.5 ${accent.noteBoxClass}`}>
            <p className={`text-sm ${accent.noteTextClass}`}>{liveData.statusNote}</p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-white/30">
          {formatCheckedAt(liveData.lastCheckedAt)}
        </p>

        {/* Action chips — expand/tap surface only, not shown on the collapsed node face. */}
        <div className="mt-4">
          <ActionChips items={actionChips} />
          {chipMessage && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/50">
              {chipMessage}
            </p>
          )}
        </div>

        {/* Client/property rollup */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="text-lg font-bold tabular-nums text-white">
              {formatCount(liveData.clientCount)}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Clients
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="text-lg font-bold tabular-nums text-white">
              {formatCount(liveData.propertyCount)}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Properties
            </p>
          </div>
        </div>

        {liveData.summary && (
          <p className="mt-2.5 text-xs leading-relaxed text-white/50">
            {liveData.summary}
          </p>
        )}

        {/* Properties list stub */}
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
            Properties
          </p>
          {liveData.properties.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-xs text-white/40">
              No property data yet — nothing to list until Propfolio&rsquo;s
              data syncs here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {liveData.properties.map((property) => (
                <PropertyRow key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/40">
          Fixing this happens from Deck / Cursor later, in the Propfolio
          repo — this sheet is a status glance only.
        </p>

        <AskGrokPanel
          project="propfolio"
          projectLabel="Propfolio"
          placeholder="fix Bayview debt digits, merge payslip-only skip…"
          statusSnapshot={askGrokSnapshot}
        />

        <div className="mt-4 flex flex-col gap-2">
          {hasUrl ? (
            <a
              href={liveData.url}
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
            href={liveData.repoUrl}
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
