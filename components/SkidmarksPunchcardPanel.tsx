"use client";

import { useRef, useState } from "react";
import { parsePunchcardJson, type SkidmarksPunchcard } from "@/lib/skidmarks";

interface SkidmarksPunchcardPanelProps {
  onAttach: (punchcard: SkidmarksPunchcard) => void;
  onClose: () => void;
}

/**
 * Paste-or-upload UI for a JSON "punchcard" — like an old piano-roll
 * punchcard, but for movie beats. This build only checks the text parses
 * as JSON and stores it; it does not validate against any scene schema
 * or feed a real pipeline. See `SkidmarksPunchcard` in `lib/skidmarks.ts`
 * for the placeholder shape a punchcard is expected to grow into.
 */
export function SkidmarksPunchcardPanel({
  onAttach,
  onClose,
}: SkidmarksPunchcardPanelProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const contents = await file.text();
      setText(contents);
      setFileName(file.name);
      setError(null);
    } catch {
      setError("Couldn't read that file \u2014 try pasting the JSON instead.");
    } finally {
      e.target.value = "";
    }
  };

  const handleAttach = () => {
    const result = parsePunchcardJson(text, fileName);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAttach(result.punchcard);
  };

  return (
    <div className="mt-2 rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-rose-200/80">
          Attach a punchcard (JSON)
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close punchcard attach"
          className="rounded-full p-1 text-white/40 hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(undefined);
          if (error) setError(null);
        }}
        placeholder={'{ "title": "…", "scenes": [] }'}
        rows={4}
        maxLength={20000}
        aria-label="Punchcard JSON"
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono text-xs text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white/80"
        >
          {fileName ?? "Upload .json"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={handleAttach}
          disabled={text.trim().length === 0}
          className="rounded-lg bg-rose-400/20 px-3 py-1.5 text-[11px] font-medium text-rose-100 transition-colors hover:bg-rose-400/30 active:bg-rose-400/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Attach
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}
