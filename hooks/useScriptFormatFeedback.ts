"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SCRIPT_FORMAT_FEEDBACK_MS,
  scriptFormatButtonLabel,
  type ScriptFormatResult,
} from "@/lib/scriptFormatFeedback";

/** The Format button's label, plus `show(changed)` to call after each
 * tap: "✓ Formatted" or "Already tidy" for a moment, then "⇥ Format". */
export function useScriptFormatFeedback(): { label: string; show: (changed: boolean) => void } {
  const [result, setResult] = useState<ScriptFormatResult>(null);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );
  const show = useCallback((changed: boolean) => {
    setResult(changed ? "formatted" : "tidy");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setResult(null), SCRIPT_FORMAT_FEEDBACK_MS);
  }, []);
  return { label: scriptFormatButtonLabel(result), show };
}
