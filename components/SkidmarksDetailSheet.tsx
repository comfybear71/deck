"use client";

import { useEffect, useRef, useState } from "react";
import type { SkidmarksMessage, SkidmarksProject } from "@/lib/skidmarks";
import { useDialModes } from "@/hooks/useDialModes";
import { useSkidmarksProjects } from "@/hooks/useSkidmarksProjects";
import { DialControl } from "./DialControl";
import { AskGrokPanel } from "./AskGrokPanel";
import { SkidmarksStageChips } from "./SkidmarksStageChips";

interface SkidmarksDetailSheetProps {
  onClose: () => void;
}

/** ms between each scripted director reply "arriving" — a new project's
 * first message (the brief itself) shows almost instantly since it's the
 * user's own text; the director's staged replies land with a small delay
 * so the thread reads as "typing", not a wall of text dumped at once. */
const FIRST_REVEAL_DELAY_MS = 250;
const REPLY_REVEAL_DELAY_MS = 650;

function DirectorBubble({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="max-w-[95%] rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-rose-50">
      {text}
    </div>
  );
}

function ChatMessage({ message }: { message: SkidmarksMessage }) {
  if (message.kind === "text") {
    const isUser = message.role === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={[
            "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-white/10 text-white"
              : "border border-rose-400/20 bg-rose-400/[0.06] text-rose-50",
          ].join(" ")}
        >
          {message.text}
        </div>
      </div>
    );
  }

  if (message.kind === "cast-cards") {
    return (
      <div className="flex flex-col gap-2">
        <DirectorBubble text={message.text} />
        <div className="grid grid-cols-2 gap-2">
          {message.castCards?.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-rose-400/20 bg-white/[0.03] p-2.5"
            >
              <p className="text-xs font-semibold text-white">{c.role}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-white/40">
                {c.note}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (message.kind === "plate-board") {
    return (
      <div className="flex flex-col gap-2">
        <DirectorBubble text={message.text} />
        <div className="grid grid-cols-2 gap-2">
          {message.plateSlots?.map((slot) => (
            <div
              key={slot.id}
              className="flex h-14 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-2 text-center text-[10px] leading-snug text-white/30"
            >
              {slot.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (message.kind === "stage-chips") {
    return (
      <div className="flex flex-col gap-2">
        <DirectorBubble text={message.text} />
        {message.stage && <SkidmarksStageChips current={message.stage} />}
      </div>
    );
  }

  return null;
}

/**
 * Skidmarks' detail sheet — a "vibe director" front end for a convoluted
 * backend, deliberately abstract. Opens a scrolling director-chat thread
 * (rendered by `ChatMessage` below) plus a "new project" composer,
 * instead of any Comfy/ffmpeg-flavored dump. See the README's "Skidmarks
 * node (vibe director)" section for exactly what's real vs. scripted
 * here.
 */
export function SkidmarksDetailSheet({ onClose }: SkidmarksDetailSheetProps) {
  const { modes, setMode } = useDialModes();
  const { projects, activeProjectId, createProject, setActiveProject } =
    useSkidmarksProjects();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const [brief, setBrief] = useState("");
  const [revealCount, setRevealCount] = useState(activeProject?.messages.length ?? 0);
  const justCreatedIdRef = useRef<string | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Reopening a past project (or the sheet mounting with an already-active
  // one) should show its whole thread at once — only a project created in
  // *this* sheet session gets the staged reveal animation below. Adjusted
  // during render (not an effect) so switching projects doesn't cost an
  // extra "flash of full thread then reset" render — see React's "you
  // might not need an effect" guidance on adjusting state from props.
  const [renderedProjectId, setRenderedProjectId] = useState<string | null>(
    activeProject?.id ?? null
  );
  if ((activeProject?.id ?? null) !== renderedProjectId) {
    setRenderedProjectId(activeProject?.id ?? null);
    if (!activeProject) {
      setRevealCount(0);
    } else if (justCreatedIdRef.current !== activeProject.id) {
      setRevealCount(activeProject.messages.length);
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [revealCount, activeProject?.id]);

  function revealNext(project: SkidmarksProject, from: number) {
    if (from >= project.messages.length) return;
    const delay = from === 0 ? FIRST_REVEAL_DELAY_MS : REPLY_REVEAL_DELAY_MS;
    revealTimerRef.current = setTimeout(() => {
      setRevealCount(from + 1);
      revealNext(project, from + 1);
    }, delay);
  }

  const handleCreateProject = () => {
    const trimmed = brief.trim();
    if (!trimmed) return;
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    const project = createProject(trimmed);
    justCreatedIdRef.current = project.id;
    setBrief("");
    setRevealCount(0);
    revealNext(project, 0);
  };

  const handleSelectProject = (id: string) => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setActiveProject(id);
  };

  const visibleMessages = activeProject
    ? activeProject.messages.slice(0, revealCount)
    : [];
  const isRevealing = Boolean(
    activeProject && revealCount < activeProject.messages.length
  );

  const pastProjects = projects.filter((p) => p.id !== activeProjectId);

  const askGrokSnapshot = activeProject
    ? {
        brief: activeProject.brief,
        stage: activeProject.stage,
        castCount: activeProject.cast.length,
        plateCount: activeProject.plates.length,
      }
    : undefined;

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
          "relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl",
          "sm:max-w-md sm:rounded-3xl",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Skidmarks — vibe director"
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-sm font-semibold text-rose-300"
            >
              {"\u2665"}
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">Skidmarks</h2>
              <p className="text-[11px] uppercase tracking-wide text-rose-300">
                Vibe director
              </p>
            </div>
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

        <div className="flex-1 overflow-y-auto px-5">
          {!activeProject ? (
            <div className="rounded-2xl border border-dashed border-rose-400/20 bg-rose-400/[0.03] px-4 py-6 text-center">
              <p className="text-sm font-medium text-white/80">
                Nothing running yet.
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/40">
                Type a vibe brief below — a scene, a band, a mood — and
                Skidmarks starts directing: locks the brief, suggests cast,
                opens an empty plate board, and lines up the stages ahead.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-2">
              {visibleMessages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isRevealing && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-3.5 py-2.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-300/70 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-300/70" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-300/70 [animation-delay:0.2s]" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {pastProjects.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                Earlier projects
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pastProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProject(p.id)}
                    className="max-w-[160px] truncate rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white/80"
                    title={p.brief}
                  >
                    {p.brief}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeProject && (
            <AskGrokPanel
              project="skidmarks"
              projectLabel="Skidmarks"
              placeholder="loop Grok in on this vibe brief…"
              statusSnapshot={askGrokSnapshot}
            />
          )}

          <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-white/70">Make lane dial</p>
              <DialControl
                value={modes.hearts}
                onChange={(mode) => setMode("hearts", mode)}
                size="md"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Same control-plane dial as the Tab&rsquo;s Make lane — pausing it
              here pauses it there too.
            </p>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-white/30">
            This is the front end only — no Comfy MCP, Seedance, LTX, or
            ElevenLabs calls happen from here yet, and it doesn&rsquo;t
            touch {"skidmarks.aiglitch.app"}&rsquo;s Crash Lab. Every reply
            above is scripted from your brief text, not a real render.
          </p>
        </div>

        <div className="border-t border-white/10 bg-zinc-950 p-5 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
            {activeProject ? "Start a new project" : "New project"}
          </p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="desert band music video, Hole Jo on sax, dusk light…"
            rows={2}
            maxLength={500}
            aria-label="Vibe brief"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreateProject}
            disabled={brief.trim().length === 0}
            className="mt-2 w-full rounded-xl bg-rose-400/20 px-4 py-2.5 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-400/30 active:bg-rose-400/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start directing
          </button>
        </div>
      </div>
    </div>
  );
}
