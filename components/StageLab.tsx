"use client";

/**
 * Stage lab — `/stage-lab` only.
 *
 * Hard-locked to Deliciae (Shorts folder `deliciae`). Read-only Cast/
 * Locations from saved session + character/location deck_items. Own
 * localStorage key. Never writes the studio session. No project picker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_SHOT_CAST } from "@/lib/shotCast";
import {
  DELICIAE_SCENE_LABEL,
  STAGE_FRAMES,
  STAGE_KIND_LABEL,
  STAGE_LENGTHS,
  STAGE_MOVES,
  STAGE_STILL_COST_USD,
  buildDeliciaeStarter,
  compileStageGodScript,
  compileStagePrompt,
  isTalkingPersonShot,
  lockedCameraFor,
  makeBlankShot,
  presentActors,
  remapShotsToCast,
  renumberShots,
  resolveStageChain,
  stageVideoBackend,
  tickActor,
  type StageCastMember,
  type StageLocation,
  type StageScene,
  type StageShot,
} from "@/lib/stageLab";
import { DELICIAE_NOT_FOUND, loadStageLabCast } from "@/lib/stageLabCast";
import { makeStagePlate } from "@/lib/stageLabPlate";
import { readStageLabStore, writeStageLabStore, hydrateStageShot } from "@/lib/stageLabStore";

function Chip({
  on,
  children,
  onClick,
  disabled,
  kind,
}: {
  on: boolean;
  children: string;
  onClick: () => void;
  disabled?: boolean;
  kind?: StageCastMember["kind"];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[36px] rounded-md px-2.5 text-[12px] font-medium disabled:opacity-40 ${
        on ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/40" : "bg-white/5 text-white/45 ring-1 ring-white/10"
      }`}
    >
      {children}
      {kind ? <span className="ml-1 text-[10px] text-white/40">{STAGE_KIND_LABEL[kind]}</span> : null}
    </button>
  );
}

export function StageLab() {
  const [cast, setCast] = useState<StageCastMember[]>([]);
  const [locations, setLocations] = useState<StageLocation[]>([]);
  const [castStatus, setCastStatus] = useState<"loading" | "saved" | "empty" | "missing">("loading");
  const [castError, setCastError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<StageScene[]>([{ id: "scene_act1_kitchen", label: DELICIAE_SCENE_LABEL }]);
  const [shots, setShots] = useState<StageShot[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedActor, setExpandedActor] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const persistTimer = useRef<number | null>(null);
  const hydrated = useRef(false);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snap = await loadStageLabCast();
      if (cancelled) return;
      setCast(snap.actors);
      setLocations(snap.locations);
      setCastError(snap.error);
      if (!snap.found) {
        setCastStatus("missing");
        setShots([]);
        setOpenId(null);
        hydrated.current = true;
        return;
      }
      setCastStatus(snap.source === "saved" ? "saved" : "empty");
      const stored = readStageLabStore();
      if (stored && stored.shots.length > 0) {
        setScenes(stored.scenes);
        const next = remapShotsToCast(
          stored.shots.map((s) => hydrateStageShot(s, snap.actors)),
          snap.actors,
          snap.locations,
        );
        setShots(next);
        setOpenId(stored.openShotId && next.some((s) => s.id === stored.openShotId) ? stored.openShotId : next[0]?.id ?? null);
      } else {
        const starter = buildDeliciaeStarter(snap.actors, snap.locations);
        setScenes([starter.scene]);
        setShots(starter.shots);
        setOpenId(starter.shots[0]?.id ?? null);
      }
      hydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (castStatus === "missing" || castStatus === "loading") return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      writeStageLabStore({ scenes, shots, openShotId: openId, projectId: "deliciae" });
    }, 200);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [scenes, shots, openId, castStatus]);

  const shot = shots.find((s) => s.id === openId) ?? shots[0];
  const location = locations.find((l) => l.id === shot?.locationId) ?? null;
  const lockedTalk = shot ? isTalkingPersonShot(shot) : false;
  const camera = shot ? lockedCameraFor(shot) : { cameraMove: "hold" as const, framing: "mcu" as const };
  const compiled = useMemo(
    () => (shot ? compileStagePrompt(shot, location) : null),
    [shot, location],
  );
  const chain = shot ? resolveStageChain(shots, shot) : null;
  const present = shot ? presentActors(shot) : [];
  const canApprove = Boolean(shot?.plateStatus === "ready" && shot.plateUrl);
  const renderLabel = compiled
    ? `${compiled.backend.toUpperCase()} ${compiled.durationSec}s · ~$${compiled.costUsd.toFixed(2)}`
    : "";

  function patch(partial: Partial<StageShot>) {
    if (!shot) return;
    setShots((all) => all.map((s) => (s.id === shot.id ? { ...s, ...partial } : s)));
  }

  function patchActor(id: string, partial: Partial<StageShot["actors"][number]>) {
    if (!shot) return;
    setShots((all) =>
      all.map((s) =>
        s.id === shot.id ? { ...s, approved: false, actors: s.actors.map((a) => (a.id === id ? { ...a, ...partial } : a)) } : s,
      ),
    );
  }

  async function onMakePlate() {
    if (!shot || shot.plateStatus === "making") return;
    patch({ plateStatus: "making", plateError: null, approved: false });
    const result = await makeStagePlate(shots, shot, location);
    if (!result.ok) {
      patch({ plateStatus: "failed", plateError: result.message, approved: false });
      flash(result.message);
      return;
    }
    patch({ plateStatus: "ready", plateUrl: result.plateUrl, plateError: null, approved: false });
    flash(
      result.spentUsd > 0
        ? `Plate still saved. About $${result.spentUsd.toFixed(2)} Grok still.`
        : "Chained last frame onto this card.",
    );
  }

  function onAddShot() {
    const scene = scenes.find((s) => s.id === shot?.sceneId) ?? scenes[0];
    if (!scene) return;
    const next = makeBlankShot(shots, scene, cast, shot?.locationId ?? null);
    setShots(renumberShots([...shots, next]));
    setOpenId(next.id);
  }

  function onDeleteShot() {
    if (shots.length <= 1 || !shot) {
      flash("Keep at least one shot.");
      return;
    }
    const next = renumberShots(shots.filter((s) => s.id !== shot.id));
    setShots(next);
    setOpenId(next[Math.max(0, shot.number - 2)]?.id ?? next[0]?.id ?? null);
  }

  function onMove(dir: -1 | 1) {
    if (!shot) return;
    const i = shots.findIndex((s) => s.id === shot.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shots.length) return;
    const copy = [...shots];
    const [row] = copy.splice(i, 1);
    copy.splice(j, 0, row);
    setShots(renumberShots(copy));
  }

  if (castStatus === "missing") {
    return (
      <div className="mx-auto min-h-dvh max-w-[430px] bg-black px-3 pt-8 text-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">Stage lab · sandbox</p>
        <h1 className="mt-1 text-[17px] font-semibold">Director board</h1>
        <p className="mt-3 text-[13px] text-white/80">{castError || DELICIAE_NOT_FOUND}</p>
      </div>
    );
  }

  if (!shot) {
    return (
      <div className="mx-auto min-h-dvh max-w-[430px] bg-black px-3 pt-8 text-white">
        <p className="text-[12px] text-white/60">{castStatus === "loading" ? "Loading saved Cast…" : "No shots yet."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-black text-white">
      <header className="border-b border-amber-300/25 bg-black px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">Stage lab · sandbox</p>
        <h1 className="text-[17px] font-semibold leading-tight">Director board</h1>
        <p className="mt-1 text-[11px] leading-snug text-white/55">
          Deliciae Cast and Locations only. Shots save here, not into Shorts.
        </p>
        <p className="mt-1 text-[10px] text-white/40">
          {castStatus === "loading"
            ? "Loading Cast…"
            : `${cast.length} Cast · ${locations.length} Locations`}
          {castError ? ` · ${castError}` : ""}
        </p>
      </header>

      <div
        className="mt-2 flex gap-2 overflow-x-auto px-3 pb-2 touch-pan-x"
        style={{ WebkitOverflowScrolling: "touch" }}
        role="list"
        aria-label="Scene storyboard"
      >
        {shots.map((card) => {
          const names = presentActors(card)
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
                setExpandedActor(presentActors(card)[0]?.id ?? null);
              }}
              className={`w-44 shrink-0 overflow-hidden rounded-md text-left ${on ? "ring-2 ring-cyan-300" : "ring-1 ring-white/15"}`}
            >
              <div className="flex h-28 items-center justify-center bg-zinc-900">
                {card.plateUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.plateUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-2 text-center text-[11px] text-amber-200/80">No still yet — Make plate</span>
                )}
              </div>
              <div className="bg-zinc-950 px-2 py-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold">#{card.number}</span>
                  <span className="text-[10px] text-white/45">
                    {card.durationSec}s · {stageVideoBackend(card).toUpperCase()}
                  </span>
                </div>
                <p className="truncate text-[10px] text-white/60">{names || "empty"}</p>
                <p className="text-[10px] text-white/35">
                  {card.approved ? "Approved" : card.plateStatus === "ready" ? "Still ready" : "No still"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <article className="px-3 pb-10 pt-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Shot {shot.number}</h2>
          <div className="flex gap-1">
            <button type="button" onClick={() => onMove(-1)} className="min-h-[36px] rounded-md px-2 text-[12px] ring-1 ring-white/15">
              ←
            </button>
            <button type="button" onClick={() => onMove(1)} className="min-h-[36px] rounded-md px-2 text-[12px] ring-1 ring-white/15">
              →
            </button>
            <button type="button" onClick={onAddShot} className="min-h-[36px] rounded-md px-2 text-[12px] ring-1 ring-white/15">
              + Shot
            </button>
            <button type="button" onClick={onDeleteShot} className="min-h-[36px] rounded-md px-2 text-[12px] text-rose-200 ring-1 ring-rose-300/30">
              Delete
            </button>
          </div>
        </div>

        <div className="mt-2 h-40 overflow-hidden rounded-md ring-1 ring-white/15">
          {shot.plateUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.plateUrl} alt={`Shot ${shot.number} still`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center bg-zinc-950 text-[12px] text-amber-200/80">
              {shot.plateStatus === "making" ? "Making plate…" : "No still yet"}
            </div>
          )}
        </div>
        {shot.plateError ? <p className="mt-1 text-[11px] text-rose-200">{shot.plateError}</p> : null}

        <label className="mt-3 block text-[11px] text-white/50">Set</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {locations.length === 0 ? <p className="text-[11px] text-white/40">No saved Locations on this device.</p> : null}
          {locations.map((loc) => (
            <Chip
              key={loc.id}
              on={shot.locationId === loc.id}
              onClick={() =>
                patch({
                  locationId: loc.id,
                  approved: false,
                  startMode: shot.startMode === "chain" && loc.id !== shot.locationId ? "plate" : shot.startMode,
                  chainFromNumber: shot.startMode === "chain" && loc.id !== shot.locationId ? null : shot.chainFromNumber,
                })
              }
            >
              {loc.name}
            </Chip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-white/50">On stage — only ticked Cast pictures are sent (max {MAX_SHOT_CAST})</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {shot.actors.length === 0 ? <p className="text-[11px] text-white/40">No saved Cast cards loaded.</p> : null}
          {shot.actors.map((actor) => (
            <Chip
              key={actor.id}
              on={actor.present}
              kind={actor.kind}
              onClick={() => {
                const next = tickActor(shot, actor.id, !actor.present);
                setShots((all) => all.map((s) => (s.id === shot.id ? next : s)));
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
                  <span className="ml-1 text-[10px] font-normal text-white/40">{STAGE_KIND_LABEL[actor.kind]}</span>
                  {!actor.pictureUrl ? <span className="ml-1 text-[10px] text-rose-200">no picture</span> : null}
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
                    <Chip on={shot.speakerId === actor.id} onClick={() => patch({ speakerId: actor.id, approved: false })}>
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
          Camera {lockedTalk ? "— talking person: Hold + MCU / close-up locked" : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {STAGE_MOVES.map((m) => (
            <Chip
              key={m.id}
              on={camera.cameraMove === m.id}
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
          {STAGE_FRAMES.map((f) => (
            <Chip
              key={f.id}
              on={camera.framing === f.id}
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
          {STAGE_LENGTHS.map((n) => (
            <Chip key={n} on={shot.durationSec === n} onClick={() => patch({ durationSec: n })}>
              {`${n}s`}
            </Chip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-white/50">Start</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Chip on={shot.startMode === "plate"} onClick={() => patch({ startMode: "plate", chainFromNumber: null, approved: false })}>
            Fresh plate
          </Chip>
          <Chip
            on={shot.startMode === "chain"}
            onClick={() =>
              patch({
                startMode: "chain",
                chainFromNumber: shot.number > 1 ? shot.number - 1 : 1,
                approved: false,
              })
            }
          >
            {`Chain from shot ${shot.number > 1 ? shot.number - 1 : 1}`}
          </Chip>
        </div>
        <p className="mt-1 text-[10px] text-white/40">
          {shot.startMode === "chain"
            ? chain && !chain.ok
              ? chain.reason
              : "Chain copies the last frame only — not who is ticked."
            : "Chain copies the last frame only — not who is ticked. Blocked if the set changes."}
        </p>

        <details
          open={promptOpen}
          onToggle={(e) => setPromptOpen((e.target as HTMLDetailsElement).open)}
          className="mt-3 rounded-md bg-white/[0.03] p-2 ring-1 ring-white/10"
        >
          <summary className="min-h-[36px] cursor-pointer text-[12px] font-medium text-white/80">Prompt preview</summary>
          {compiled ? (
            <>
              <p className="mt-1 text-[11px] font-medium text-white/55">Images that will be sent</p>
              <ul className="mt-0.5 list-inside list-disc text-[11px] text-white/70">
                {compiled.images.map((img) => (
                  <li key={img.index}>
                    Image {img.index}: {img.label}
                    {img.url ? "" : " — missing"}
                  </li>
                ))}
              </ul>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-white/70">{compiled.platePrompt}</pre>
            </>
          ) : null}
        </details>

        <details className="mt-2 rounded-md bg-white/[0.03] p-2 ring-1 ring-white/10">
          <summary className="min-h-[36px] cursor-pointer text-[12px] font-medium text-white/80">God Script export (preview only)</summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug text-cyan-100/80">
            {compileStageGodScript(shot, location)}
          </pre>
          <p className="mt-1 text-[10px] text-white/40">Does not write into an episode.</p>
        </details>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={shot.plateStatus === "making"}
            onClick={() => void onMakePlate()}
            className="min-h-[40px] rounded-md border border-cyan-300/30 px-3 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
          >
            {shot.plateStatus === "making"
              ? "Making plate…"
              : shot.plateStatus === "ready"
                ? `Remake plate (~$${STAGE_STILL_COST_USD.toFixed(2)})`
                : `Make plate (~$${STAGE_STILL_COST_USD.toFixed(2)})`}
          </button>
          <button
            type="button"
            disabled={!canApprove}
            onClick={() => {
              patch({ approved: true });
              flash("Still approved. Render is Phase 2 — not billed from this page.");
            }}
            className="min-h-[40px] rounded-md border border-emerald-300/35 px-3 text-[12px] font-semibold text-emerald-100 disabled:opacity-40"
          >
            {shot.approved ? "Approved" : "Approve still"}
          </button>
          <button
            type="button"
            disabled
            title="Phase 2 — one-shot video is not wired on this page yet."
            className="min-h-[40px] flex-1 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 text-[12px] font-semibold text-amber-100/70"
          >
            {`Render · Phase 2 · ${renderLabel}`}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-white/45">
          {shot.approved
            ? "Render is Phase 2 on this page: one paid shot through Grok (silent / objects) or LTX (talking humans), behind Approve + a dollar confirm. Not wired yet, so this button stays disabled — never a silent no-op."
            : canApprove
              ? "Approve the still before paying."
              : "Make a plate still first. White-void starts are refused."}
        </p>
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
