"use client";

import type { LastSync } from "@/lib/overrides";

interface MailSyncLineProps {
  lastMailSync: LastSync;
}

function formatSyncLabel(lastMailSync: LastSync): string {
  if (lastMailSync.at === null) return "none yet";
  const when = new Date(lastMailSync.at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const noun = lastMailSync.count === 1 ? "receipt" : "receipts";
  return `${when} \u00b7 ${lastMailSync.count} ${noun}`;
}

/**
 * Tiny "Last mail sync" line, cost deep-dive sheet only — not a full admin
 * panel, just enough to see the Mail -> Tab ingest bridge is alive.
 * `toLocaleString`'s output can legitimately differ between the server
 * render and the viewer's browser timezone for the same timestamp;
 * `suppressHydrationWarning` tells React that's expected here (same fix
 * Next.js's own docs use for locale-dependent timestamps), rather than
 * deferring the whole label to an effect.
 */
export function MailSyncLine({ lastMailSync }: MailSyncLineProps) {
  return (
    <p
      className="mt-2 text-center text-[10px] text-white/25"
      suppressHydrationWarning
    >
      Last mail sync: {formatSyncLabel(lastMailSync)}
    </p>
  );
}
