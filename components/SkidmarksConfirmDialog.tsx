"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface SkidmarksConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  /** The destructive button's label, e.g. "Delete band". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * One in-app "Are you sure?" for every delete/remove control in
 * Skidmarks (2026-09-16, Stuart's direct ask after removing renders by
 * accident with no warning). Deliberately not `window.confirm`: iOS
 * Safari's native dialog is small, easy to fat-finger, and can be
 * suppressed in a home-screen web app. This is a real overlay with
 * ≥44px buttons, Cancel first and biggest, attached to `document.body`
 * (same portal shape as `SkidmarksClipStub`'s lightbox — iOS stacking
 * bugs otherwise let it render under a sheet). Escape cancels.
 */
export function SkidmarksConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: SkidmarksConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Cancel" onClick={onCancel} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skidmarks-confirm-title"
        className="relative z-10 m-4 w-full max-w-sm rounded-2xl border border-rose-400/30 bg-zinc-950 p-5 shadow-2xl"
      >
        <h3 id="skidmarks-confirm-title" className="text-base font-semibold text-white">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{body}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="min-h-[48px] w-full rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            Cancel — keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] w-full rounded-full border border-rose-400/40 bg-rose-500/20 px-4 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/30"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
