"use client";

import { useRef, useState } from "react";
import {
  MAX_MEMBERS_PER_BAND,
  lookGradientClass,
  readImageFileAsDataUrl,
  type SkidmarksBand,
  type SkidmarksMember,
} from "@/lib/skidmarks";

interface SkidmarksMembersModuleProps {
  band: SkidmarksBand;
  onOpenMember: (memberId: string) => void;
  onAddMember: () => void;
  onRemoveMember: (memberId: string) => void;
  onSetMemberAvatarImage: (memberId: string, dataUrl: string) => void;
}

/** Native file picker's accept list — jpg/png/webp only, matches what a
 * phone's own photo library exports. */
const AVATAR_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

function CameraGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
      <path
        d="M4 7.5h2l1-1.5h6l1 1.5h2v8H4v-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="11.5" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A member's avatar, plus a tiny camera badge that opens a real native
 * file picker to set a real photo (`avatarImage`) — an alternative to
 * generating a mock "look" in the popup. Precedence: a picked
 * `avatarImage` wins outright, else the latest generated look's
 * gradient + emoji, else a dashed placeholder ring.
 */
function MemberAvatar({
  member,
  onPickPhoto,
}: {
  member: SkidmarksMember;
  onPickPhoto: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [picking, setPicking] = useState(false);
  const latestLook = member.looks[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicking(true);
    try {
      onPickPhoto(file);
    } finally {
      setPicking(false);
    }
  };

  const avatarClasses = member.avatarImage
    ? "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/15"
    : latestLook
      ? [
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg ring-2 ring-emerald-400/70",
          lookGradientClass(latestLook.seed),
        ].join(" ")
      : "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-white/15 bg-white/[0.06] text-lg ring-1 ring-white/15";

  return (
    <span className="relative shrink-0">
      <span aria-hidden className={avatarClasses}>
        {member.avatarImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL photo, next/image can't optimize it
          <img src={member.avatarImage} alt="" className="h-full w-full object-cover" />
        ) : (
          member.emoji
        )}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
        disabled={picking}
        aria-label={
          member.name.trim() ? `Add or change a photo for ${member.name}` : "Add a photo for this member"
        }
        title="Add a real photo"
        className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/70 text-white/80 ring-1 ring-black/40 transition-colors hover:bg-black/90 hover:text-white disabled:opacity-60"
      >
        <CameraGlyph />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={AVATAR_IMAGE_ACCEPT}
        onClick={(e) => e.stopPropagation()}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
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
  onPickPhoto,
}: {
  member: SkidmarksMember;
  onOpen: () => void;
  onRemove: () => void;
  onPickPhoto: (file: File) => void;
}) {
  const displayName = member.name.trim() || "New member";
  return (
    <div className="flex w-full items-center gap-1">
      {/* A `div` (not `button`) so the avatar's own photo-picker button can
          nest inside it validly — buttons can't contain interactive content. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={
          member.name.trim() ? `Generate a look for ${member.name}` : "Name and generate a look for this member"
        }
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <MemberAvatar member={member} onPickPhoto={onPickPhoto} />
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
      </div>
      <RemoveMemberButton memberName={member.name} onRemove={onRemove} />
    </div>
  );
}

/**
 * The members module — one shared pink-bordered box (band name once at
 * top, then a member row per cast member; tapping a row opens the
 * generate-look/rename popup, tapping the trash glyph removes that
 * member outright, and the tiny camera badge on the avatar opens a real
 * native file picker to set a real photo — see `MemberAvatar`).
 * Newly-added members start completely blank (no name, role, emoji, or
 * photo — see `buildBlankMember`) and render with a dashed avatar ring
 * and dimmed "New member" placeholder text until the user names them,
 * picks a real photo, or generates a first look. The "+ Add member"
 * pill lives *outside* the box, under-right, per the locked mockup —
 * it's a sibling of this component in `SkidmarksDetailSheet`, not
 * rendered in here.
 */
export function SkidmarksMembersModule({
  band,
  onOpenMember,
  onAddMember,
  onRemoveMember,
  onSetMemberAvatarImage,
}: SkidmarksMembersModuleProps) {
  const canAddMore = band.members.length < MAX_MEMBERS_PER_BAND;

  const handlePickPhoto = async (memberId: string, file: File) => {
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      onSetMemberAvatarImage(memberId, dataUrl);
    } catch {
      // Couldn't decode the picked file — leave the existing avatar as-is.
    }
  };

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
              onPickPhoto={(file) => handlePickPhoto(member.id, file)}
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
