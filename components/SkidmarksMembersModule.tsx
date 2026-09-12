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
  onRemoveMember: (memberId: string) => void;
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
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-white/15 bg-white/[0.06] text-lg ring-1 ring-white/15"
    >
      {member.emoji}
    </span>
  );
}

function RemoveMemberButton({
  memberName,
  onRemove,
}: {
  memberName: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={memberName ? `Remove ${memberName}` : "Remove member"}
      title="Remove member"
      className="shrink-0 rounded-full p-1.5 text-white/30 transition-colors hover:bg-red-500/10 hover:text-red-400"
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d="M5 5.5h10M8.25 5.5v-1a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1M6.25 5.5l.5 9a1 1 0 0 0 1 .95h4.5a1 1 0 0 0 1-.95l.5-9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function MemberRow({
  member,
  onOpen,
  onRemove,
}: {
  member: SkidmarksMember;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const displayName = member.name.trim() || "New member";
  return (
    <div className="flex w-full items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={
          member.name.trim() ? `Generate a look for ${member.name}` : "Name and generate a look for this member"
        }
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <MemberAvatar member={member} />
        <span className="min-w-0 flex-1">
          <span
            className={[
              "block truncate text-sm font-semibold",
              member.name.trim() ? "text-white" : "text-white/35",
            ].join(" ")}
          >
            {displayName}
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
      <RemoveMemberButton memberName={member.name} onRemove={onRemove} />
    </div>
  );
}

/**
 * The members module — one shared pink-bordered box (band name once at
 * top, then a member row per cast member; tapping a row opens the
 * generate-look/rename popup, tapping the trash glyph removes that
 * member outright). Newly-added members start completely blank (no
 * name, role, or emoji — see `buildBlankMember`) and render with a
 * dashed avatar ring and dimmed "New member" placeholder text until the
 * user names them or generates a first look. The "+ Add member" pill
 * lives *outside* the box, under-right, per the locked mockup — it's a
 * sibling of this component in `SkidmarksDetailSheet`, not rendered in
 * here.
 */
export function SkidmarksMembersModule({
  band,
  onOpenMember,
  onAddMember,
  onRemoveMember,
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
              onRemove={() => onRemoveMember(member.id)}
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
