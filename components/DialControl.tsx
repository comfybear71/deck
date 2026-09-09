"use client";

import type { DialMode } from "@/lib/types";
import { DIAL_LABEL, DIAL_MODES } from "@/lib/constants";

interface DialControlProps {
  value: DialMode;
  onChange: (mode: DialMode) => void;
  size?: "sm" | "md";
}

export function DialControl({ value, onChange, size = "sm" }: DialControlProps) {
  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs";

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full bg-white/5 p-0.5 ring-1 ring-white/10"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label="Meter dial"
    >
      {DIAL_MODES.map((mode) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-pressed={active}
            className={[
              "rounded-full font-medium tracking-wide transition-colors",
              padding,
              active
                ? "bg-white text-black shadow-sm"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {DIAL_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}
