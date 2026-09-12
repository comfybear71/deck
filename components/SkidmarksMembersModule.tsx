"use client";

import {
  MAX_MEMBERS_PER_BAND,
  lookGradientClass,
  type SkidmarksBand,
  type SkidmarksMember,
} from "@/lib/skidmarks";

interface SkidmarksMembersModuleProps {
  band: SkidmarksBand;
  onOpenMember: (memberId: string) => void;
  onAddMember: () => void;
}

function MemberAvatar({ member }: { member: SkidmarksMember }) {
  const latestLook = member.looks[0];
  if (latestLook) {
    return (
      <span
        aria-hidden
        className={[
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg ring-2 ring-emerald-400/70",
          lookGradientClass(latestLook.seed),
        ].join(" ")}
      >
        {member.emoji}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-lg ring-1 ring-white/15"
    >
      {member.emoji}
    </span>
  );
}

function MemberRow({
  member,
  onOpen,
}: {
  member: SkidmarksMember;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Generate a look for ${member.name}`}
      className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-white/[0.04]"
    >
      <MemberAvatar member={member} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {member.name}
        </span>
        {member.role && (
          <span className="block truncate text-[11px] uppercase tracking-wide text-rose-300/70">
            {member.role}
          </span>
        )}
      </span>
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-white/25">
        <path
          d="M7.5 4l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * The members module — one shared pink-bordered box (band name once at
 * top, then a member row per cast member; tapping a member's avatar
 * opens the generate-look popup). The "+ Add member" pill lives *outside*
 * the box, under-right, per the locked mockup — it's a sibling of this
 * component in `SkidmarksDetailSheet`, not rendered in here.
 */
export function SkidmarksMembersModule({
  band,
  onOpenMember,
  onAddMember,
}: SkidmarksMembersModuleProps) {
  const canAddMore = band.members.length < MAX_MEMBERS_PER_BAND;

  return (
    <div>
      <div className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.03] p-4">
        <h3 className="mb-2 truncate text-base font-bold text-rose-200">{band.name}</h3>
        <div className="flex flex-col divide-y divide-white/[0.06]">
          {band.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              onOpen={() => onOpenMember(member.id)}
            />
          ))}
        </div>
      </div>

      {canAddMore && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={onAddMember}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-400/10 px-3.5 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-400/20 active:bg-rose-400/25"
          >
            <span aria-hidden className="text-sm leading-none">
              +
            </span>
            Add member
          </button>
        </div>
      )}
    </div>
  );
}
