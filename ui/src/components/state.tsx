/**
 * States, drawn as a dot + word (rail, members, status). Ready is green, in-progress is the
 * accent, attention is ochre with a hollow dot, inactive is hollow grey.
 * Never red: a failure here is a state to fix, not an alarm.
 */
export type Tone = "ok" | "attention" | "pending" | "muted";

export const dot: Record<Tone, string> = {
  ok: "bg-ok",
  attention: "border-[1.5px] border-warn",
  pending: "border-[1.5px] border-ink-3",
  muted: "border-[1.5px] border-ink-3",
};

const word: Record<Tone, string> = {
  ok: "text-ok",
  attention: "text-warn",
  pending: "text-ink-3",
  muted: "text-ink-3",
};

export function Dot({ tone, label }: { tone: Tone; label: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${word[tone]}`}>
      <span aria-hidden className={`inline-block size-[7px] shrink-0 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  );
}
