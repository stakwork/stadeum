"use client";

import { useEffect, useState } from "react";

import { SectionLabel } from "@/components/page-header";
import { installProgressText, type InstallWatch } from "@/lib/packages";
import { installProgress } from "./actions";

/** How often a running install is read again: strut's own Packages tab reads it this often. */
export const INSTALL_POLL_MS = 600;

const going = (w: InstallWatch | null) => !!w && (w.status === "queued" || w.status === "running");

/**
 * Follow an install: read it again every INSTALL_POLL_MS until it ends,
 * never while the tab is hidden (it reads at once when the tab shows
 * again). `note` says why the last read had no record: `final` when strut
 * no longer holds one, else strut did not answer and the next read tries
 * again.
 */
export function useInstallWatch(first: InstallWatch | null) {
  const [watch, setWatch] = useState(first);
  const [note, setNote] = useState<{ text: string; final: boolean }>();
  const id = going(watch) && !note?.final ? watch!.id : null;

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!stopped) timer = setTimeout(read, INSTALL_POLL_MS);
    };
    async function read() {
      timer = undefined;
      if (stopped || reading || document.visibilityState === "hidden") return;
      reading = true;
      const r = await installProgress(id!).catch(() => ({ error: "Strut isn’t answering just now. Still trying.", retry: true, status: undefined }));
      reading = false;
      if (stopped) return;
      if (r.status === undefined) {
        setNote({ text: r.error, final: !r.retry });
        if (r.retry) schedule();
        return;
      }
      setNote(undefined);
      setWatch(r);
      if (going(r)) schedule();
    }
    const onShow = () => {
      if (document.visibilityState === "visible" && !timer && !reading) void read();
    };
    document.addEventListener("visibilitychange", onShow);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [id]);

  /** Follow another install from here: a new start after a refusal. */
  const follow = (w: InstallWatch) => {
    setNote(undefined);
    setWatch(w);
  };
  return { watch, follow, note };
}

/** What an install is doing, in a line, over a bar: full by how far a counted phase is, a soft pulse when the phase does not count. */
export function InstallBar({ watch, label }: { watch: InstallWatch; label: string }) {
  const { text, fraction } = installProgressText(watch);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p aria-live="polite" className="text-[13.5px] break-words text-ink-2 tabular-nums">
        {text}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={text}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(fraction !== undefined ? { "aria-valuenow": Math.round(fraction * 100) } : {})}
        className={`h-1.5 overflow-hidden rounded-full bg-accent-soft ${fraction === undefined ? "motion-safe:animate-pulse" : ""}`}
      >
        {fraction !== undefined && (
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out-soft" style={{ width: `${Math.max(fraction * 100, 2)}%` }} />
        )}
      </div>
    </div>
  );
}

/**
 * The installs going on now, whichever door started them: one the admin
 * left by closing its dialog, or one strut was already running when the
 * page loaded (another admin's, a proposal someone accepted, the box's
 * boot list, its distro). Each says how far it is, then how it ended,
 * until dismissed.
 */
export function Installing({ installs, onDismiss }: { installs: InstallWatch[]; onDismiss: (id: string) => void }) {
  if (installs.length === 0) return null;
  return (
    <section aria-labelledby="installing" className="flex flex-col gap-3">
      <SectionLabel id="installing">Installing</SectionLabel>
      <ul className="divide-y divide-rule-soft rounded-xl border border-rule bg-surface">
        {installs.map((w) => (
          <InstallRow key={w.id} first={w} onDismiss={() => onDismiss(w.id)} />
        ))}
      </ul>
    </section>
  );
}

function InstallRow({ first, onDismiss }: { first: InstallWatch; onDismiss: () => void }) {
  const { watch, note } = useInstallWatch(first);
  const w = watch!;
  const ended = !going(w) || note?.final;
  const name = <code className="font-mono text-[14px] break-all text-ink">{w.status === "done" ? w.result.package : w.ref}</code>;
  return (
    <li className="flex flex-col gap-2.5 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[14.5px] text-ink">
          {w.status === "done" ? (
            <>
              {w.result.already ? "Already installed: " : "Installed "}
              {name}
              {w.result.version && !w.result.already ? <span className="text-ink-3">, version {w.result.version}</span> : null}
            </>
          ) : w.status === "failed" ? (
            <>{name} didn’t install</>
          ) : (
            <>
              {name}
              {w.door === "distro" && <span className="text-ink-3"> · by the box’s distro</span>}
            </>
          )}
        </span>
        {ended && (
          <button type="button" onClick={onDismiss} className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Dismiss
          </button>
        )}
      </div>
      {going(w) && !note?.final && <InstallBar watch={w} label={`Installing ${w.ref}`} />}
      {w.status === "done" && w.result.missingSecrets.length > 0 && (
        <p className="text-[13.5px] text-ink-2">Its steps still need {w.result.missingSecrets.length === 1 ? "a key" : "keys"}: set them under Installed.</p>
      )}
      {w.status === "failed" && (
        <p role="alert" className="text-[13.5px] break-words text-warn">
          {w.error}
        </p>
      )}
      {note && <p className={`text-[13px] ${note.final ? "text-warn" : "text-ink-3"}`}>{note.text}</p>}
    </li>
  );
}
