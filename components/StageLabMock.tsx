"use client";

/**
 * Clickable Stage lab mock — `/stage-lab` only.
 *
 * Not imported by Sunny Banks / Skidmarks / Music video / Shorts.
 * Hardcoded Deliciae Act I kitchen sample. Does not write the studio
 * session or Neon. No paid fetch. Taps only rewrite this page's React state.
 */

import { useState } from "react";

type CastKind = "person" | "animal" | "object";
type CameraMove = "hold" | "push-in" | "pull-back" | "pan" | "tracking" | "dutch";
type Framing = "cu" | "mcu" | "medium" | "wide" | "ots" | "low" | "high";
type StartMode = "plate" | "chain";
type Backend = "ltx" | "grok";

type Actor = {
  id: string;
  name: string;
  kind: CastKind;
  present: boolean;
  action: string;
  look: string;
  voice: boolean;
};

type Shot = {
  id: string;
  number: number;
  sceneLabel: string;
  locationId: string;
  locationLabel: string;
  actors: Actor[];
  speakerId: string | null;
  line: string;
  cameraMove: CameraMove;
  framing: Framing;
  durationSec: number;
  startMode: StartMode;
  chainFrom: number | null;
  plateReady: boolean;
  approved: boolean;
  note: string;
};

const LENGTHS = [5, 8, 10, 12, 15] as const;

const MOVES: { id: CameraMove; label: string }[] = [
  { id: "hold", label: "Hold" },
  { id: "push-in", label: "Push-in" },
  { id: "pull-back", label: "Pull-back" },
  { id: "pan", label: "Pan" },
  { id: "tracking", label: "Tracking" },
  { id: "dutch", label: "Dutch" },
];

const FRAMES: { id: Framing; label: string }[] = [
  { id: "cu", label: "Close-up" },
  { id: "mcu", label: "MCU" },
  { id: "medium", label: "Medium" },
  { id: "wide", label: "Wide" },
  { id: "ots", label: "OTS" },
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
];

const LOCATIONS = [
  { id: "kitchen", label: "Kitchen" },
  { id: "bedroom", label: "Bedroom" },
];

const KIND_LABEL: Record<CastKind, string> = {
  person: "Person",
  animal: "Animal",
  object: "Object",
};

function grokCost(sec: number): number {
  return Math.round((sec * 0.14 + 0.01) * 100) / 100;
}

function ltxCost(sec: number): number {
  return Math.round(sec * 0.13 * 100) / 100;
}

function talkingPerson(shot: Shot): boolean {
  const speaker = shot.actors.find((a) => a.id === shot.speakerId);
  return Boolean(shot.line.trim() && speaker?.kind === "person" && speaker.voice);
}

function backendFor(shot: Shot): Backend {
  return talkingPerson(shot) ? "ltx" : "grok";
}

function moveLine(move: CameraMove): string {
  switch (move) {
    case "hold":
      return "Camera holds — a static, locked-off frame.";
    case "push-in":
      return "Slow push-in zoom.";
    case "pull-back":
      return "Gentle pull-back.";
    case "pan":
      return "Slow pan.";
    case "tracking":
      return "Tracking / follow-behind.";
    case "dutch":
      return "Dutch angle, slight tilt.";
  }
}

function frameLine(framing: Framing): string {
  switch (framing) {
    case "cu":
      return "Close-up, face and mouth readable.";
    case "mcu":
      return "MCU — chest-up, mouth readable.";
    case "medium":
      return "Medium shot.";
    case "wide":
      return "Wide, full body, the whole set in frame.";
    case "ots":
      return "Over-the-shoulder, looking into the scene.";
    case "low":
      return "Low angle, looking up.";
    case "high":
      return "High angle, looking down.";
  }
}

function compilePrompt(shot: Shot): string {
  const present = shot.actors.filter((a) => a.present);
  const speaker = shot.actors.find((a) => a.id === shot.speakerId);
  const lockedTalk = talkingPerson(shot);
  const move = lockedTalk ? "hold" : shot.cameraMove;
  const framing = lockedTalk ? "mcu" : shot.framing;
  const who = present.map((a) => `${a.name} (${KIND_LABEL[a.kind].toLowerCase()})`).join(", ") || "empty set";
  const actions = present
    .filter((a) => a.action.trim())
    .map((a) => `${a.name}: ${a.action.trim()}`)
    .join(" ");
  const images = [
    `Image 1: Location “${shot.locationLabel}” still${shot.startMode === "chain" ? ` (chained last frame of shot ${shot.chainFrom})` : ""}.`,
    ...present.map((a, i) => `Image ${i + 2}: ${a.name} Cast card (${KIND_LABEL[a.kind]}).`),
  ];
  const head = lockedTalk
    ? `Use the provided start image as the first frame. ${speaker?.name} is prominent, mouth and head move naturally while speaking, subtle gesture. Props and background stay exactly as the start image, nothing new enters frame. ${speaker?.name} says: "${shot.line.trim()}". Camera holds. Same person and objects as the start image.`
    : `Use the provided start image as the first frame. ${actions || `${speaker?.name ?? "The set"} holds.`} No invented human face. Props and background stay exactly as the start image, nothing new enters frame. No cuts.`;
  const objectTalk =
    shot.line.trim() && speaker && speaker.kind !== "person"
      ? ` ${speaker.name} (${KIND_LABEL[speaker.kind].toLowerCase()}) delivers: "${shot.line.trim()}" — do not turn this object into a person.`
      : "";
  return [
    head + objectTalk,
    moveLine(move),
    frameLine(framing),
    `On stage: ${who}.`,
    images.join(" "),
  ].join(" ");
}

function compileGodScript(shot: Shot): string {
  const present = shot.actors.filter((a) => a.present);
  const speaker = shot.actors.find((a) => a.id === shot.speakerId);
  const lockedTalk = talkingPerson(shot);
  const move = lockedTalk ? "hold" : shot.cameraMove;
  const framing = lockedTalk ? "mcu" : shot.framing;
  const looks = present
    .filter((a) => a.look.trim())
    .map((a) => `[Character ${a.name}: ${a.look.trim()}]`)
    .join("\n");
  const action = [
    present
      .filter((a) => a.action.trim())
      .map((a) => a.action.trim())
      .join(" "),
    moveLine(move),
    frameLine(framing),
  ]
    .filter(Boolean)
    .join(" ");
  const line = speaker ? `${speaker.name}:${shot.line.trim() ? ` ${shot.line.trim()}` : ""}` : "Crowd:";
  return [
    `=== ${shot.sceneLabel} ===`,
    `[Location: ${shot.locationId}]`,
    present.length ? `[Cast: ${present.map((a) => a.name).join(", ")}]` : null,
    looks || null,
    `[Action: ${action}]`,
    `[Duration: ${shot.durationSec}s]`,
    line,
  ]
    .filter(Boolean)
    .join("\n");
}

function sampleShots(): Shot[] {
  const house: Actor = {
    id: "house",
    name: "House",
    kind: "object",
    present: true,
    action: "Wall speaker greets from above the fridge, cyan to violet pulsing ring",
    look: "cyan to violet pulsing ring, no face",
    voice: true,
  };
  const arthur: Actor = {
    id: "arthur",
    name: "Arthur",
    kind: "person",
    present: true,
    action: "Stands in the kitchen doorway, listening",
    look: "",
    voice: true,
  };
  const pip: Actor = {
    id: "pip",
    name: "Pip",
    kind: "animal",
    present: false,
    action: "",
    look: "palm-sized robot dog",
    voice: false,
  };
  const droid: Actor = {
    id: "droid",
    name: "Service droid",
    kind: "object",
    present: false,
    action: "",
    look: "kitchen service droid",
    voice: false,
  };

  const cast = (): Actor[] => [structuredClone(house), structuredClone(arthur), structuredClone(pip), structuredClone(droid)];

  const s1 = cast();
  s1[0].present = true;
  s1[1].present = true;
  s1[2].present = false;
  s1[3].present = false;

  const s2 = cast();
  s2[0].present = true;
  s2[0].action = "Listens from the wall, ring idle violet";
  s2[1].present = true;
  s2[1].action = "At the counter, orders breakfast";
  s2[2].present = false;
  s2[3].present = false;

  const s3 = cast();
  s3[0].present = false;
  s3[1].present = true;
  s3[1].action = "Claps, rubs hands, walks to the table and sits";
  s3[2].present = false;
  s3[3].present = false;

  const s4 = cast();
  s4[0].present = false;
  s4[1].present = true;
  s4[1].action = "Sits at the table, waits";
  s4[2].present = false;
  s4[3].present = true;
  s4[3].action = "Gets eggs on toast and a cappuccino from the PLATTER INC replicator and serves Arthur";

  return [
    {
      id: "s1",
      number: 1,
      sceneLabel: "ACT I — KITCHEN",
      locationId: "kitchen",
      locationLabel: "Kitchen",
      actors: s1,
      speakerId: "house",
      line: "Good morning, Arthur.",
      cameraMove: "hold",
      framing: "medium",
      durationSec: 5,
      startMode: "plate",
      chainFrom: null,
      plateReady: true,
      approved: false,
      note: "Object speaker — Grok, never LTX face",
    },
    {
      id: "s2",
      number: 2,
      sceneLabel: "ACT I — KITCHEN",
      locationId: "kitchen",
      locationLabel: "Kitchen",
      actors: s2,
      speakerId: "arthur",
      line: "Eggs on toast and a cappuccino, thanks.",
      cameraMove: "hold",
      framing: "mcu",
      durationSec: 5,
      startMode: "chain",
      chainFrom: 1,
      plateReady: true,
      approved: false,
      note: "Talking person — LTX, camera Hold + MCU locked",
    },
    {
      id: "s3",
      number: 3,
      sceneLabel: "ACT I — KITCHEN",
      locationId: "kitchen",
      locationLabel: "Kitchen",
      actors: s3,
      speakerId: "arthur",
      line: "",
      cameraMove: "tracking",
      framing: "medium",
      durationSec: 10,
      startMode: "chain",
      chainFrom: 2,
      plateReady: true,
      approved: true,
      note: "Silent 10s Grok — length picker, not the 5s default",
    },
    {
      id: "s4",
      number: 4,
      sceneLabel: "ACT I — KITCHEN",
      locationId: "kitchen",
      locationLabel: "Kitchen",
      actors: s4,
      speakerId: "droid",
      line: "",
      cameraMove: "pan",
      framing: "wide",
      durationSec: 8,
      startMode: "plate",
      chainFrom: null,
      plateReady: false,
      approved: false,
      note: "Fresh plate — droid is Object, Arthur stays seated",
    },
  ];
}

function StillArt({ shot }: { shot: Shot }) {
  const n = shot.number;
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`k${n}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c1916" />
          <stop offset="100%" stopColor="#0c0a09" />
        </linearGradient>
        <linearGradient id={`r${n}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#k${n})`} />
      <rect x="0" y="118" width="320" height="62" fill="#292524" />
      <rect x="18" y="28" width="92" height="78" rx="4" fill="#44403c" />
      <rect x="26" y="36" width="76" height="36" rx="2" fill="#0ea5e9" opacity="0.25" />
      <rect x="210" y="40" width="88" height="70" rx="6" fill="#57534e" />
      <text x="228" y="78" fill="#a8a29e" fontSize="9" fontFamily="ui-sans-serif">
        PLATTER
      </text>
      <text x="236" y="90" fill="#a8a29e" fontSize="8" fontFamily="ui-sans-serif">
        INC
      </text>
      {shot.actors.some((a) => a.present && a.id === "house") && (
        <>
          <rect x="132" y="18" width="56" height="22" rx="11" fill="#1e1b4b" />
          <ellipse cx="160" cy="29" rx="18" ry="7" fill="none" stroke={`url(#r${n})`} strokeWidth="3" />
        </>
      )}
      {shot.actors.some((a) => a.present && a.id === "arthur") && (
        <>
          <circle cx={n === 3 ? 200 : 90} cy={n === 3 ? 92 : 88} r="14" fill="#e7d5c4" />
          <rect x={n === 3 ? 186 : 76} y={n === 3 ? 106 : 102} width="28" height="40" rx="6" fill="#d6d3d1" />
        </>
      )}
      {shot.actors.some((a) => a.present && a.id === "droid") && (
        <>
          <rect x="240" y="88" width="36" height="48" rx="8" fill="#94a3b8" />
          <circle cx="258" cy="102" r="6" fill="#22d3ee" />
        </>
      )}
      {shot.actors.some((a) => a.present && a.id === "pip") && (
        <ellipse cx="54" cy="150" rx="16" ry="10" fill="#64748b" />
      )}
      {!shot.plateReady && (
        <text x="160" y="100" textAnchor="middle" fill="#fde68a" fontSize="11" fontFamily="ui-sans-serif">
          No still yet — Make plate
        </text>
      )}
    </svg>
  );
}

function Chip({
  on,
  children,
  onClick,
  kind,
}: {
  on: boolean;
  children: string;
  onClick: () => void;
  kind?: CastKind;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[36px] rounded-md px-2.5 text-[12px] font-medium ${
        on ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/40" : "bg-white/5 text-white/45 ring-1 ring-white/10"
      }`}
    >
      {children}
      {kind ? <span className="ml-1 text-[10px] text-white/40">{KIND_LABEL[kind]}</span> : null}
    </button>
  );
}

export function StageLabMock() {
  const [shots, setShots] = useState<Shot[]>(() => sampleShots());
  const [openId, setOpenId] = useState("s1");
  const [toast, setToast] = useState<string | null>(null);
  const [expandedActor, setExpandedActor] = useState<string | null>("house");

  const shot = shots.find((s) => s.id === openId) ?? shots[0];
  const lockedTalk = talkingPerson(shot);
  const backend = backendFor(shot);
  const duration = shot.durationSec;
  const cost = backend === "ltx" ? ltxCost(duration) : grokCost(duration);
  const prompt = compilePrompt(shot);
  const god = compileGodScript(shot);
  const present = shot.actors.filter((a) => a.present);
  const canRender = shot.plateReady && shot.approved;

  function patch(partial: Partial<Shot>) {
    setShots((all) => all.map((s) => (s.id === shot.id ? { ...s, ...partial } : s)));
  }

  function patchActor(id: string, partial: Partial<Actor>) {
    setShots((all) =>
      all.map((s) =>
        s.id === shot.id
          ? { ...s, actors: s.actors.map((a) => (a.id === id ? { ...a, ...partial } : a)) }
          : s,
      ),
    );
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-black text-white">
      <header className="sticky top-0 z-10 border-b border-amber-300/25 bg-black/95 px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">Stage lab · sandbox</p>
        <h1 className="text-[17px] font-semibold leading-tight">Director board</h1>
        <p className="mt-1 text-[11px] leading-snug text-white/55">
          Separate test page. Not Sunny Banks, Skidmarks, Music video, or Shorts. Sample Cast only — your episodes are
          not loaded and cannot be saved from here.
        </p>
      </header>

      <div className="px-3 pt-3">
        <p className="text-[11px] font-medium text-white/70">{shot.sceneLabel}</p>
        <p className="text-[10px] text-white/40">Deliciae sample · Act I kitchen · 4 shots</p>
      </div>

      <div
        className="mt-2 flex gap-2 overflow-x-auto px-3 pb-2 touch-pan-x"
        style={{ WebkitOverflowScrolling: "touch" }}
        role="list"
        aria-label="Scene storyboard"
      >
        {shots.map((card) => {
          const names = card.actors
            .filter((a) => a.present)
            .map((a) => a.name)
            .join(" + ");
          const on = card.id === shot.id;
          return (
            <button
              key={card.id}
              type="button"
              role="listitem"
              onClick={() => {
                setOpenId(card.id);
                setExpandedActor(card.actors.find((a) => a.present)?.id ?? null);
              }}
              className={`w-44 shrink-0 overflow-hidden rounded-md text-left ${
                on ? "ring-2 ring-cyan-300" : "ring-1 ring-white/15"
              }`}
            >
              <div className="h-28 bg-zinc-900">
                <StillArt shot={card} />
              </div>
              <div className="bg-zinc-950 px-2 py-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold">#{card.number}</span>
                  <span className="text-[10px] text-white/45">
                    {card.durationSec}s · {backendFor(card).toUpperCase()}
                  </span>
                </div>
                <p className="truncate text-[10px] text-white/60">{names || "empty"}</p>
                <p className="text-[10px] text-white/35">
                  {card.approved ? "Approved" : card.plateReady ? "Still ready" : "No still"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <article className="px-3 pb-10 pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Shot {shot.number}</h2>
          <span className="text-[10px] text-amber-200/80">{shot.note}</span>
        </div>

        <div className="mt-2 h-40 overflow-hidden rounded-md ring-1 ring-white/15">
          <StillArt shot={shot} />
        </div>

        <label className="mt-3 block text-[11px] text-white/50">Set</label>
        <div className="mt-1 flex gap-1.5">
          {LOCATIONS.map((loc) => (
            <Chip
              key={loc.id}
              on={shot.locationId === loc.id}
              onClick={() => patch({ locationId: loc.id, locationLabel: loc.label, approved: false })}
            >
              {loc.label}
            </Chip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-white/50">On stage — only ticked Cast pictures are sent</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {shot.actors.map((actor) => (
            <Chip
              key={actor.id}
              on={actor.present}
              kind={actor.kind}
              onClick={() => {
                patchActor(actor.id, { present: !actor.present });
                patch({ approved: false });
                setExpandedActor(actor.id);
              }}
            >
              {actor.name}
            </Chip>
          ))}
        </div>

        {present.map((actor) => {
          const open = expandedActor === actor.id;
          return (
            <div key={actor.id} className="mt-2 rounded-md bg-white/[0.04] p-2 ring-1 ring-white/10">
              <button
                type="button"
                className="flex min-h-[36px] w-full items-center justify-between text-left text-[12px] font-medium"
                onClick={() => setExpandedActor(open ? null : actor.id)}
              >
                <span>
                  {actor.name}
                  <span className="ml-1 text-[10px] font-normal text-white/40">{KIND_LABEL[actor.kind]}</span>
                </span>
                <span className="text-white/35">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="mt-1 space-y-2">
                  <label className="block text-[11px] text-white/45">
                    Action / pose
                    <textarea
                      value={actor.action}
                      onChange={(e) => patchActor(actor.id, { action: e.target.value })}
                      rows={2}
                      className="script-box mt-0.5 w-full resize-none rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-white"
                    />
                  </label>
                  <div className="flex gap-1.5">
                    <Chip
                      on={shot.speakerId === actor.id}
                      onClick={() => patch({ speakerId: actor.id, approved: false })}
                    >
                      Speaks
                    </Chip>
                    {actor.kind !== "person" && (
                      <span className="self-center text-[10px] text-white/40">Won&apos;t use LTX face</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <label className="mt-3 block text-[11px] text-white/50">
          Line {shot.line.trim() ? "" : "(empty = silent)"}
          <textarea
            value={shot.line}
            onChange={(e) => patch({ line: e.target.value, approved: false })}
            rows={2}
            className="script-box mt-0.5 w-full resize-none rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-white"
            placeholder="What they say. Leave blank for a silent shot."
          />
        </label>

        <p className="mt-3 text-[11px] text-white/50">
          Camera {lockedTalk ? "— talking person: Hold + MCU locked" : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MOVES.map((m) => (
            <Chip
              key={m.id}
              on={(lockedTalk ? "hold" : shot.cameraMove) === m.id}
              onClick={() => {
                if (lockedTalk && m.id !== "hold") {
                  flash("Talking person keeps camera Hold.");
                  return;
                }
                patch({ cameraMove: m.id });
              }}
            >
              {m.label}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FRAMES.map((f) => (
            <Chip
              key={f.id}
              on={(lockedTalk ? "mcu" : shot.framing) === f.id}
              onClick={() => {
                if (lockedTalk && f.id !== "mcu" && f.id !== "cu") {
                  flash("Talking person stays MCU / close-up.");
                  return;
                }
                patch({ framing: f.id });
              }}
            >
              {f.label}
            </Chip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-white/50">Length</p>
        <div className="mt-1 flex gap-1.5">
          {LENGTHS.map((n) => (
            <Chip key={n} on={shot.durationSec === n} onClick={() => patch({ durationSec: n })}>
              {`${n}s`}
            </Chip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-white/50">Start</p>
        <div className="mt-1 flex gap-1.5">
          <Chip
            on={shot.startMode === "plate"}
            onClick={() => patch({ startMode: "plate", chainFrom: null, approved: false })}
          >
            Fresh plate
          </Chip>
          <Chip
            on={shot.startMode === "chain"}
            onClick={() =>
              patch({
                startMode: "chain",
                chainFrom: shot.number > 1 ? shot.number - 1 : 1,
                approved: false,
              })
            }
          >
            {`Chain from shot ${shot.number > 1 ? shot.number - 1 : 1}`}
          </Chip>
        </div>
        <p className="mt-1 text-[10px] text-white/40">Chain copies the last frame only — not who is ticked.</p>

        <details key={`prompt-${shot.id}`} className="mt-3 rounded-md bg-white/[0.03] p-2 ring-1 ring-white/10">
          <summary className="min-h-[36px] cursor-pointer text-[12px] font-medium text-white/80">Prompt preview</summary>
          <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-white/70">{prompt}</pre>
        </details>

        <details key={`god-${shot.id}`} className="mt-2 rounded-md bg-white/[0.03] p-2 ring-1 ring-white/10">
          <summary className="min-h-[36px] cursor-pointer text-[12px] font-medium text-white/80">
            God Script export (preview only)
          </summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug text-cyan-100/80">{god}</pre>
          <p className="mt-1 text-[10px] text-white/40">Does not write into an episode. Copy later, after this lab is real.</p>
        </details>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              patch({ plateReady: true, approved: false });
              flash("Mock still only — no Grok call, ~$0.02 if this were live.");
            }}
            className="min-h-[40px] rounded-md border border-cyan-300/30 px-3 text-[12px] font-semibold text-cyan-100"
          >
            {shot.plateReady ? "Remake plate (~$0.02)" : "Make plate (~$0.02)"}
          </button>
          <button
            type="button"
            disabled={!shot.plateReady}
            onClick={() => {
              patch({ approved: true });
              flash("Still approved. Render is still a separate tap.");
            }}
            className="min-h-[40px] rounded-md border border-emerald-300/35 px-3 text-[12px] font-semibold text-emerald-100 disabled:opacity-40"
          >
            {shot.approved ? "Approved" : "Approve still"}
          </button>
          <button
            type="button"
            disabled={!canRender}
            onClick={() => flash("Mock only — no paid render. This would be one shot, not the whole scene.")}
            className="min-h-[40px] flex-1 rounded-md border border-amber-300/40 bg-amber-300/15 px-3 text-[12px] font-semibold text-amber-100 disabled:opacity-40"
          >
            {canRender
              ? `Render · ${backend.toUpperCase()} ${duration}s · ~$${cost.toFixed(2)}`
              : `Render locked · ${backend.toUpperCase()} ~$${cost.toFixed(2)}`}
          </button>
        </div>
        {!canRender && (
          <p className="mt-1.5 text-[11px] text-white/45">
            {shot.plateReady ? "Approve the still before paying." : "Make a plate still first. White-void starts are refused."}
          </p>
        )}
      </article>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-md bg-zinc-900 px-3 py-2 text-[12px] text-white ring-1 ring-white/20"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
