"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { submitAsk } from "@/lib/deck-ask-client";
import type { DeckAskStatusSnapshot } from "@/lib/deck-ask";

interface AskGrokPanelProps {
  /** Stable project id sent to `/api/deck/ask`, e.g. "propfolio". */
  project: string;
  /** Display name used in copy, e.g. "Propfolio". */
  projectLabel: string;
  placeholder: string;
  /** Point-in-time status snapshot bundled with the ask — see `DeckAskStatusSnapshot`. */
  statusSnapshot?: DeckAskStatusSnapshot;
}

interface QueuedAsk {
  prompt: string;
  queuedAt: number;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * Generic "Ask Grok" composer — a short text field + Send that POSTs to
 * the thin `/api/deck/ask` control-plane stub and, on success, shows a
 * copyable prompt for Grok Bot (QA Engineer) plus a "queued" confirmation.
 * Deliberately does not call Grok directly and does not use any
 * `grokbot://` compose deep link — this queues an ask and hands Stuart a
 * prompt to paste in himself. See the README's "Ask Grok (v0 stub)"
 * section.
 *
 * Generic over `project`/`projectLabel`/`statusSnapshot` so Propfolio's
 * detail sheet is the first caller but a future Budju panel can reuse this
 * unchanged.
 */
export function AskGrokPanel({
  project,
  projectLabel,
  placeholder,
  statusSnapshot,
}: AskGrokPanelProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedAsk | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const canSend = message.trim().length > 0 && !sending;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    try {
      const { prompt } = await submitAsk({
        project,
        message: trimmed,
        statusSnapshot,
        ts: Date.now(),
      });
      setQueued({ prompt, queuedAt: Date.now() });
      setCopyState("idle");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send \u2014 try again.");
    } finally {
      setSending(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!queued) return;
    const ok = await copyToClipboard(queued.prompt);
    setCopyState(ok ? "copied" : "failed");
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
        Ask Grok
      </p>

      <textarea
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          if (error) setError(null);
        }}
        placeholder={placeholder}
        rows={2}
        maxLength={500}
        aria-label={`Ask Grok about ${projectLabel}`}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-white/30">
          Queues for {projectLabel} — doesn&rsquo;t call Grok directly from
          here.
        </p>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 active:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "Sending\u2026" : "Send"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      {queued && (
        <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-3">
          <p className="text-xs font-medium text-emerald-200">
            Queued ✓ — copy this into Grok Bot (QA Engineer):
          </p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-[11px] leading-relaxed text-white/70">
            {queued.prompt}
          </pre>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="mt-2 w-full rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 active:bg-white/25"
          >
            {copyState === "copied"
              ? "Copied!"
              : copyState === "failed"
                ? "Copy failed \u2014 select the text above manually"
                : "Copy prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
