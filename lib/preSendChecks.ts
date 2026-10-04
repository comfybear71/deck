/**
 * Free checks on one row before any paid render (2026-10-04, Stuart:
 * "a free pre-send check on each row"). One list of rules for every show
 * (Sunny Banks, Skidmarks, Shorts script rows and Shorts shot cards), so
 * a lesson learnt on one show protects the others. Each rule comes from
 * a real render that went wrong:
 *
 * 1. The speaker isn't in the shot: the render falls back to someone else
 *    (EP03 shot 4, Kai's line on Ned). Blocks the render.
 * 2. A Cast name in the prompt isn't in the shot: that person isn't sent,
 *    so the engine makes up a stranger with their name.
 * 3. A talking row asking for a smile, a grin, looking down, head down or
 *    eyes on something: LTX freezes or loses the mouth (EP03 shot 3).
 * 4. "film still" makes a strip of frames; "no panels" / "no split screen"
 *    puts the very idea in, and comes back with white bars.
 * 5. A talking Line with no tag at the end gets cut off mid-word; a
 *    [laugh] in the middle freezes the lip-sync.
 * 6. A talking shot too short for its Line (under ~6 s, or under the time
 *    the words take to say), or a Line so short its clip is only a few
 *    seconds (lip-sync is less reliable).
 *
 * Pure and free: nothing is sent anywhere. Only rule 1 blocks; the rest
 * are warnings shown next to Render.
 */

export type PreSendLevel = "block" | "warn";

export type PreSendCode =
  | "speaker_not_in_shot"
  | "cast_not_in_shot"
  | "lipsync_freeze_words"
  | "film_still"
  | "negated_panels"
  | "line_no_trailing_tag"
  | "line_mid_laugh"
  | "talking_too_short";

export interface PreSendIssue {
  code: PreSendCode;
  level: PreSendLevel;
  message: string;
}

export interface PreSendRow {
  /** `"speak"` for a talking row, `"hold"` for a silent one. */
  kind: "speak" | "hold";
  /** Who says the line (talking rows). */
  speakerName?: string | null;
  /** Everyone in the shot, by name. */
  inShotNames: readonly string[];
  /** Everyone in the episode's Cast (for rule 2). */
  castNames: readonly string[];
  /** The picture/motion text: the shot prompt, or `[Action:]` plus looks. */
  promptText: string;
  /** The spoken Line, ElevenLabs tags kept. */
  line?: string;
  /** The shot's length when it has one (shot cards); unknown on script rows (the voice sets it). */
  durationSec?: number | null;
}

/** About how fast a Line is said, for rule 6. */
export const PRE_SEND_WORDS_PER_SEC = 2.5;
/** The shortest talking shot that reliably lip-syncs. */
export const PRE_SEND_MIN_TALKING_SEC = 6;

function norm(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, name: string): boolean {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** Words that freeze or hide the mouth on a talking shot (rule 3). */
export const LIPSYNC_FREEZE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bhalf[- ]smil(e|es|ing)\b/i, label: "half smile" },
  { re: /\bsmil(e|es|ed|ing)\b/i, label: "smile" },
  { re: /\bgrin(s|ning|ned)?\b/i, label: "grin" },
  { re: /\blook(s|ing|ed)? down\b/i, label: "looking down" },
  { re: /\bhead (is |tilted |tipped |bowed )?down\b/i, label: "head down" },
  { re: /\beyes (fixed |locked |glued )?on\b/i, label: "eyes on …" },
];

const SPEAKER_RULE = (name: string) =>
  `${name} says this line but isn't in the shot, so someone else would say it. Add ${name} to the shot first.`;

/** Every issue for one row, blocks first. Free; nothing is sent. */
export function preSendChecks(row: PreSendRow): PreSendIssue[] {
  const issues: PreSendIssue[] = [];
  const inShot = new Set(row.inShotNames.map(norm).filter(Boolean));
  const prompt = row.promptText ?? "";
  const line = (row.line ?? "").trim();
  const talking = row.kind === "speak" && line.length > 0;
  const speaker = row.speakerName?.trim() ?? "";

  // 1. Speaker not in the shot.
  if (talking && speaker && !inShot.has(norm(speaker))) {
    issues.push({ code: "speaker_not_in_shot", level: "block", message: SPEAKER_RULE(speaker) });
  }

  // 2. A Cast name in the prompt that isn't in the shot.
  const strangers = row.castNames.filter((name) => name.trim() && !inShot.has(norm(name)) && mentions(prompt, name));
  const seen = new Set<string>();
  for (const name of strangers) {
    if (seen.has(norm(name))) continue;
    seen.add(norm(name));
    issues.push({
      code: "cast_not_in_shot",
      level: "warn",
      message: `The prompt names ${name}, but ${name} isn't in the shot: you'll get a made-up stranger. Add ${name} to the shot, or take the name out.`,
    });
  }

  // 3. Words that freeze the lip-sync on a talking row.
  if (talking) {
    const found = LIPSYNC_FREEZE_PATTERNS.filter((p) => p.re.test(prompt)).map((p) => p.label);
    // "half smile" already covers "smile".
    const labels = found.includes("half smile") ? found.filter((l) => l !== "smile") : found;
    if (labels.length > 0) {
      issues.push({
        code: "lipsync_freeze_words",
        level: "warn",
        message: `"${labels.join('", "')}" on a talking shot can freeze the lip-sync. Keep the head level and the mouth visible; put that in a silent shot instead.`,
      });
    }
  }

  // 4. Words that break the picture.
  if (/\bfilm[- ]still\b/i.test(prompt)) {
    issues.push({
      code: "film_still",
      level: "warn",
      message: `"film still" tends to make a strip of frames. Say "film look" or "35mm film" instead.`,
    });
  }
  if (/\bno (split[- ]?screens?|panels?|collage|grid)\b/i.test(prompt)) {
    issues.push({
      code: "negated_panels",
      level: "warn",
      message: `"no panels" / "no split screen" puts the idea in and tends to come back with white bars. Leave it out.`,
    });
  }

  // 5. The Line's tags.
  if (talking) {
    if (!/\[[^\]]+\]\s*$/.test(line)) {
      issues.push({
        code: "line_no_trailing_tag",
        level: "warn",
        message: "The Line has no tag at the end, so the voice can stop mid-word. End it with a tag like [pause] or [exhales].",
      });
    }
    const laugh = /\[(laugh|laughs|laughing|chuckles?|giggles?)\]/gi;
    let m: RegExpExecArray | null;
    while ((m = laugh.exec(line))) {
      const after = line.slice(m.index + m[0].length).replace(/\[[^\]]*\]/g, "").trim();
      if (after.length > 0) {
        issues.push({
          code: "line_mid_laugh",
          level: "warn",
          message: `${m[0]} in the middle of the Line freezes the lip-sync. Move it to the end.`,
        });
        break;
      }
    }
  }

  // 6. Too short for the Line. A shot with a set length is checked
  // against the words; a talking shot as long as its voice (script rows,
  // talking shot cards) is checked on about how long the words take.
  const words = line.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
  const needSec = words / PRE_SEND_WORDS_PER_SEC;
  if (talking && words > 0 && !(typeof row.durationSec === "number" && row.durationSec > 0) && needSec < PRE_SEND_MIN_TALKING_SEC - 2) {
    issues.push({
      code: "talking_too_short",
      level: "warn",
      message: `This Line takes about ${Math.max(1, Math.round(needSec))}s to say. Talking clips much under ${PRE_SEND_MIN_TALKING_SEC}s often lose the lip-sync: add a few words, or end with a [pause].`,
    });
  }
  if (talking && typeof row.durationSec === "number" && row.durationSec > 0) {
    if (row.durationSec < PRE_SEND_MIN_TALKING_SEC || row.durationSec < needSec) {
      const want = Math.max(PRE_SEND_MIN_TALKING_SEC, Math.ceil(needSec + 1));
      issues.push({
        code: "talking_too_short",
        level: "warn",
        message: `${row.durationSec}s is short for this Line (${words} word${words === 1 ? "" : "s"}). Make the shot about ${want}s so it isn't cut off.`,
      });
    }
  }

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1));
}

/** Does any issue stop the render? */
export function preSendBlocks(issues: readonly PreSendIssue[]): boolean {
  return issues.some((i) => i.level === "block");
}
