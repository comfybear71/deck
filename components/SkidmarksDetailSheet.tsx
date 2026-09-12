"use client";

import { useEffect, useRef, useState } from "react";
import type {
  SkidmarksMessage,
  SkidmarksProject,
  SkidmarksPunchcard,
} from "@/lib/skidmarks";
import { useDialModes } from "@/hooks/useDialModes";
import { useSkidmarksProjects } from "@/hooks/useSkidmarksProjects";
import { DialControl } from "./DialControl";
import { AskGrokPanel } from "./AskGrokPanel";
import { SkidmarksStageChips } from "./SkidmarksStageChips";
import { SkidmarksPunchcardPanel } from "./SkidmarksPunchcardPanel";

interface SkidmarksDetailSheetProps {
  onClose: () => void;
}

/** ms between each scripted director reply "arriving" — a new project's
 * first message (the brief itself) shows almost instantly since it's the
 * user's own text; the director's staged replies land with a small delay
 * so the thread reads as "typing", not a wall of text dumped at once. */
const FIRST_REVEAL_DELAY_MS = 250;
const REPLY_REVEAL_DELAY_MS = 650;

const PROMPT_PLACEHOLDER = "Tell me what you want to create";

/** Light quick-start pills for the empty landing — tap one to drop a
 * sample brief into the composer (not an auto-submit), same spirit as
 * OpenArt Director's "Create film trailer" row. Purely a typing shortcut;
 * nothing here is wired to anything real. */
const QUICK_START_PILLS: { label: string; brief: string }[] = [
  {
    label: "Music video",
    brief: "desert band music video, dune buggy driving shots at dusk",
  },
  {
    label: "Band performance",
    brief: "live band performance, stage lights, punchy crowd cutaways",
  },
  {
    label: "Short film",
    brief: "short film, two characters, quiet diner at night, slow push-ins",
  },
];

function PlusButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label="Attach a JSON punchcard"
      title="Attach a JSON punchcard"
      className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
        active
          ? "bg-rose-400/20 text-rose-300"
          : "text-white/40 hover:bg-white/10 hover:text-white/70",
      ].join(" ")}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d="M10 4v12M4 10h12"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function PunchcardChip({
  punchcard,
  onRemove,
}: {
  punchcard: SkidmarksPunchcard;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-[11px] font-medium text-rose-200">
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3 shrink-0">
        <path
          d="M4 10.5l3.5 3.5L16 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="truncate">
        Punchcard loaded {"\u2014"} {punchcard.title}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove punchcard"
        className="shrink-0 text-rose-300/70 hover:text-rose-100"
      >
        {"\u2715"}
      </button>
    </span>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label="Start directing"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-400 text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d="M10 15V5M5 9l5-5 5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  size: "lg" | "sm";
  autoFocus?: boolean;
  punchcardActive: boolean;
  onTogglePunchcard: () => void;
}

/** The one control that starts (or continues) directing — a rounded pill
 * with a "+" that opens the JSON punchcard attach panel, the brief
 * textarea, and a rose submit button. Shared between the empty landing
 * (`size="lg"`) and the compact "new project" bar shown once a thread
 * exists (`size="sm"`) so both read as the same control, just
 * differently sized. */
function Composer({
  value,
  onChange,
  onSubmit,
  size,
  autoFocus,
  punchcardActive,
  onTogglePunchcard,
}: ComposerProps) {
  const isLarge = size === "lg";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={[
        "flex w-full items-end gap-2 rounded-3xl border border-white/10 bg-white/[0.04] transition-colors focus-within:border-rose-400/40",
        isLarge ? "p-2.5 pl-3.5" : "p-1.5 pl-2.5",
      ].join(" ")}
    >
      <PlusButton active={punchcardActive} onClick={onTogglePunchcard} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={PROMPT_PLACEHOLDER}
        rows={isLarge ? 2 : 1}
        maxLength={500}
        autoFocus={autoFocus}
        aria-label="Vibe brief"
        className={[
          "flex-1 resize-none bg-transparent text-white placeholder:text-white/30 focus:outline-none",
          isLarge ? "py-2 text-base" : "py-1.5 text-sm",
        ].join(" ")}
      />
      <SubmitButton disabled={value.trim().length === 0} />
    </form>
  );
}

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

function EarlierProjectsRow({
  projects,
  onSelect,
}: {
  projects: SkidmarksProject[];
  onSelect: (id: string) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className="max-w-[220px] truncate rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white/80"
          title={p.brief}
        >
          {p.brief}
        </button>
      ))}
    </div>
  );
}

/**
 * Skidmarks' empty state — the OpenArt Director–style landing Stuart
 * asked for: a clean title, a one-line tagline, one big centered prompt,
 * and (optionally) a few quick-start pills and past-project chips. This
 * landing *is* the "new project" flow — there's no separate start screen.
 */
function EmptyLanding({
  brief,
  onBriefChange,
  onSubmit,
  pastProjects,
  onSelectProject,
  punchcard,
  onAttachPunchcard,
  onRemovePunchcard,
  showPunchcardPanel,
  onTogglePunchcard,
}: {
  brief: string;
  onBriefChange: (v: string) => void;
  onSubmit: () => void;
  pastProjects: SkidmarksProject[];
  onSelectProject: (id: string) => void;
  punchcard: SkidmarksPunchcard | null;
  onAttachPunchcard: (punchcard: SkidmarksPunchcard) => void;
  onRemovePunchcard: () => void;
  showPunchcardPanel: boolean;
  onTogglePunchcard: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-10 text-center">
      <div>
        <h1 className="bg-gradient-to-br from-rose-200 via-rose-300 to-pink-400 bg-clip-text text-2xl font-bold text-transparent">
          Skidmarks Director
        </h1>
        <p className="mt-1.5 text-sm text-white/40">
          Vibe direct your next video
        </p>
      </div>

      <div className="w-full max-w-sm">
        <Composer
          value={brief}
          onChange={onBriefChange}
          onSubmit={onSubmit}
          size="lg"
          autoFocus
          punchcardActive={showPunchcardPanel || Boolean(punchcard)}
          onTogglePunchcard={onTogglePunchcard}
        />

        {showPunchcardPanel && (
          <SkidmarksPunchcardPanel onAttach={onAttachPunchcard} onClose={onTogglePunchcard} />
        )}

        {punchcard && !showPunchcardPanel && (
          <div className="mt-2 flex justify-center">
            <PunchcardChip punchcard={punchcard} onRemove={onRemovePunchcard} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {QUICK_START_PILLS.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => onBriefChange(pill.brief)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-rose-400/30 hover:text-rose-200"
            >
              {pill.label}
              <span aria-hidden className="text-white/30">
                {"\u2197"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {pastProjects.length > 0 && (
        <div className="w-full max-w-sm">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
            Earlier projects
          </p>
          <EarlierProjectsRow projects={pastProjects} onSelect={onSelectProject} />
        </div>
      )}
    </div>
  );
}

/**
 * Skidmarks' detail sheet — a "vibe director" front end for a convoluted
 * backend, deliberately abstract. Opens straight to an OpenArt
 * Director–style landing (`EmptyLanding`) when there's no project yet;
 * once a brief is submitted it switches to a scrolling director-chat
 * thread (`ChatMessage` below) with a compact composer pinned to the
 * bottom for starting the next one. See the README's "Skidmarks node
 * (vibe director)" section for exactly what's real vs. scripted here.
 */
export function SkidmarksDetailSheet({ onClose }: SkidmarksDetailSheetProps) {
  const { modes, setMode } = useDialModes();
  const {
    projects,
    activeProjectId,
    createProject,
    setActiveProject,
    setProjectPunchcard,
  } = useSkidmarksProjects();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const [brief, setBrief] = useState("");
  const [revealCount, setRevealCount] = useState(activeProject?.messages.length ?? 0);
  const justCreatedIdRef = useRef<string | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Pending punchcard attached before a project exists yet — carried
  // into `createProject` on submit, then cleared. Once a project *is*
  // active, its own `punchcard` field (persisted via
  // `setProjectPunchcard`) is the source of truth instead.
  const [pendingPunchcard, setPendingPunchcard] = useState<SkidmarksPunchcard | null>(
    null
  );
  const [showPunchcardPanel, setShowPunchcardPanel] = useState(false);

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
    const project = createProject(trimmed, pendingPunchcard ?? undefined);
    justCreatedIdRef.current = project.id;
    setBrief("");
    setRevealCount(0);
    setPendingPunchcard(null);
    setShowPunchcardPanel(false);
    revealNext(project, 0);
  };

  const handleSelectProject = (id: string) => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setActiveProject(id);
    setShowPunchcardPanel(false);
  };

  // No project yet: hold the punchcard in local state until submit.
  // Project already active: attach it straight to that project (persisted).
  const handleAttachPunchcard = (punchcard: SkidmarksPunchcard) => {
    if (activeProject) {
      setProjectPunchcard(activeProject.id, punchcard);
    } else {
      setPendingPunchcard(punchcard);
    }
    setShowPunchcardPanel(false);
  };

  const handleRemovePunchcard = () => {
    if (activeProject) {
      setProjectPunchcard(activeProject.id, null);
    } else {
      setPendingPunchcard(null);
    }
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
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-sm font-semibold text-rose-300"
            >
              {"\u2665"}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">
                Skidmarks
              </h2>
              <p className="truncate text-[11px] text-rose-300/80">
                {activeProject
                  ? `Directing \u00b7 ${activeProject.brief}`
                  : "Vibe director"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DialControl
              value={modes.hearts}
              onChange={(mode) => setMode("hearts", mode)}
              size="sm"
            />
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
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {!activeProject ? (
            <EmptyLanding
              brief={brief}
              onBriefChange={setBrief}
              onSubmit={handleCreateProject}
              pastProjects={pastProjects}
              onSelectProject={handleSelectProject}
              punchcard={pendingPunchcard}
              onAttachPunchcard={handleAttachPunchcard}
              onRemovePunchcard={handleRemovePunchcard}
              showPunchcardPanel={showPunchcardPanel}
              onTogglePunchcard={() => setShowPunchcardPanel((v) => !v)}
            />
          ) : (
            <div className="flex flex-col gap-3 py-3">
              {activeProject.punchcard && (
                <div className="flex justify-start">
                  <PunchcardChip
                    punchcard={activeProject.punchcard}
                    onRemove={handleRemovePunchcard}
                  />
                </div>
              )}
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

              {pastProjects.length > 0 && (
                <div className="mt-1">
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

              <AskGrokPanel
                project="skidmarks"
                projectLabel="Skidmarks"
                placeholder="loop Grok in on this vibe brief…"
                statusSnapshot={askGrokSnapshot}
              />
            </div>
          )}
        </div>

        {activeProject && (
          <div className="border-t border-white/10 bg-zinc-950 p-4">
            {showPunchcardPanel && (
              <SkidmarksPunchcardPanel
                onAttach={handleAttachPunchcard}
                onClose={() => setShowPunchcardPanel(false)}
              />
            )}
            <div className={showPunchcardPanel ? "mt-2" : undefined}>
              <Composer
                value={brief}
                onChange={setBrief}
                onSubmit={handleCreateProject}
                size="sm"
                punchcardActive={showPunchcardPanel || Boolean(activeProject.punchcard)}
                onTogglePunchcard={() => setShowPunchcardPanel((v) => !v)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
