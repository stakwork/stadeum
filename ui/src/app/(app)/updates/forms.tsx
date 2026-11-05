"use client";

import { useActionState } from "react";

import { buttonClass } from "@/components/button";
import { fieldClass, FormNote, Labelled, Submit } from "@/components/form";
import { saveSchedule, type FormState } from "./actions";

export function ScheduleForm({
  start,
  end,
  timeZone,
  drainMinutes,
  enabled,
  zones,
}: {
  start: string;
  end: string;
  timeZone: string;
  drainMinutes: number;
  enabled: boolean;
  zones: string[];
}) {
  const [state, action] = useActionState<FormState, FormData>(saveSchedule, {});
  return (
    <form action={action} className="flex flex-col gap-5 rounded-[14px] border border-rule bg-surface p-5 md:p-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(2,minmax(0,140px))_minmax(0,1fr)]">
        <Labelled id="window-start" label="From">
          <input id="window-start" name="start" type="time" required defaultValue={start} className={fieldClass} />
        </Labelled>
        <Labelled id="window-end" label="To">
          <input id="window-end" name="end" type="time" required defaultValue={end} className={fieldClass} />
        </Labelled>
        <div className="col-span-2 sm:col-span-1">
          <Labelled id="window-zone" label="Time zone">
            <select id="window-zone" name="timeZone" defaultValue={timeZone} className={`${fieldClass} px-3`}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      </div>
      <div className="max-w-[260px]">
        <Labelled id="drain-minutes" label="Wait for runs to finish, at most" hint="Minutes. What still runs then picks up again after the restart.">
          <input id="drain-minutes" name="drainMinutes" type="number" min={1} max={600} required defaultValue={drainMinutes} className={fieldClass} />
        </Labelled>
      </div>
      <label className="flex items-start gap-3 text-[14.5px] text-ink">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1 size-4 accent-[var(--accent)]" />
        <span className="flex flex-col gap-0.5">
          Update automatically in the window
          <span className="text-[13px] text-ink-3">Off: nothing moves until you press Update now.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <Submit className={buttonClass.primary} pendingLabel="Saving…">
          Save
        </Submit>
        <FormNote state={state} />
      </div>
    </form>
  );
}
