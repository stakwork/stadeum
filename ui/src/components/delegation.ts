import type { MothershipUser } from "@prisma/client";

import type { Tone } from "./state";

/** A person's delegation state: whether apps can run for them. */
export function describeDelegation(m: MothershipUser | null): { tone: Tone; label: string; rail: string; ready: boolean } {
  switch (m?.delegationStatus) {
    case "fresh":
    case "pushed":
      return { tone: "ok", label: "Ready", rail: "Ready to run", ready: true };
    case "failed":
      return { tone: "attention", label: "Not ready", rail: "Can't run yet", ready: false };
    case "unsupported":
      return { tone: "attention", label: "Not available", rail: "Can't run yet", ready: false };
    case "not-configured":
      return { tone: "muted", label: "Not connected", rail: "Not connected", ready: false };
    default:
      return { tone: "pending", label: "Setting up", rail: "Setting up", ready: false };
  }
}
