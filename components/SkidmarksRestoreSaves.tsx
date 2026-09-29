"use client";

import { useState } from "react";
import { flushSkidmarksSessionNow, loadSkidmarksSessionFromServerNow } from "@/lib/skidmarks";

interface Backup {
  id: number;
  revision: number;
  savedAt: string;
  characters: number;
  episodes: number;
  bands: number;
  hasAdultShorts: boolean;
}

const ENDPOINT = "/api/skidmarks/session/backups";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * "Restore an earlier save" (2026-09-30), the app's Undo. The server
 * keeps the last 500 saves; this lists the newest, with counts so each
 * one can be told apart, and a save where characters or episodes went
 * down from the one before is marked, because that is what a wipe looks
 * like. Tap one, tap again, and it comes back as a new save on top, so
 * a restore can be undone the same way.
 */
export function SkidmarksRestoreSaves() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; backups?: Backup[]; error?: string } | null;
      if (!res.ok || !body?.ok || !Array.isArray(body.backups)) {
        setError(body?.error ?? `Couldn't load past saves (HTTP ${res.status}).`);
        setBackups(null);
      } else {
        setBackups(body.backups);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setArmedId(null);
    setNotice(null);
    if (next) void load();
  };

  const restore = async (backup: Backup) => {
    if (restoringId !== null) return;
    if (armedId !== backup.id) {
      setArmedId(backup.id);
      return;
    }
    setArmedId(null);
    setRestoringId(backup.id);
    setError(null);
    setNotice(null);
    // Get any last edit on this device up first, so it is in the history too.
    flushSkidmarksSessionNow();
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: backup.id }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? `Restore failed (HTTP ${res.status}).`);
        return;
      }
      const loaded = await loadSkidmarksSessionFromServerNow();
      setNotice(
        loaded
          ? `Restored the save from ${formatWhen(backup.savedAt)}. What was there before is kept in this list too.`
          : `Restored on the server. Reload the page to see it.`
      );
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the server.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left text-[13px] font-semibold text-white/75"
      >
        <span>Restore an earlier save</span>
        <span aria-hidden className="text-white/40">
          {open ? "\u2212" : "+"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-white/10 px-4 pb-4 pt-3">
          {loading && !backups && <p className="text-[11px] text-white/45">Loading past saves…</p>}
          {error && (
            <p role="alert" className="text-[11px] text-rose-300">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-[11px] text-emerald-200/90">
              {notice}
            </p>
          )}
          {backups && backups.length === 0 && <p className="text-[11px] text-white/45">No past saves yet.</p>}
          {backups && backups.length > 0 && (
            <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
              {backups.map((backup, index) => {
                const older = backups[index + 1];
                const dropped =
                  !!older && (backup.characters < older.characters || backup.episodes < older.episodes);
                const armed = armedId === backup.id;
                return (
                  <button
                    key={backup.id}
                    type="button"
                    onClick={() => void restore(backup)}
                    onBlur={() => setArmedId((id) => (id === backup.id ? null : id))}
                    disabled={restoringId !== null}
                    className={`flex min-h-[44px] w-full flex-col items-start justify-center rounded-lg border px-3 py-2 text-left disabled:opacity-60 ${
                      armed
                        ? "border-amber-300 bg-amber-300/15"
                        : dropped
                          ? "border-rose-400/40 bg-rose-400/[0.06]"
                          : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <span className="text-[12px] font-semibold text-white/85">
                      {restoringId === backup.id
                        ? "Restoring…"
                        : armed
                          ? `Tap again to restore ${formatWhen(backup.savedAt)}`
                          : formatWhen(backup.savedAt)}
                      {index === 0 && !armed && restoringId !== backup.id && (
                        <span className="ml-1.5 text-[10px] font-medium text-white/40">(now)</span>
                      )}
                    </span>
                    <span className="text-[10px] text-white/50">
                      {plural(backup.characters, "character")} · {plural(backup.episodes, "episode")} ·{" "}
                      {plural(backup.bands, "band")}
                      {backup.hasAdultShorts ? " · adult shorts" : ""}
                      {dropped ? " · less than the save before" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
