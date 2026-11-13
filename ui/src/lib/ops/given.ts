import { isKind, KINDS, validate, type Kind, type Values } from "./destination";

/**
 * A backup destination the box's host gives at install
 * (`STADEUM_BACKUP_DESTINATION`, and optionally `STADEUM_BACKUP_PASSWORD`;
 * docs/stack-spec.md, "Backups given at install"). A host that keeps a box's
 * backups for it gives the destination, so they run from the first night
 * and nobody has to fill in the Backups page. Its value is the fields that
 * page asks for, with the kind, as JSON:
 *
 *   STADEUM_BACKUP_DESTINATION='{"kind":"s3","bucket":"…","path":"boxes/acme","region":"us-east-1","accessKeyId":"…","secretAccessKey":"…"}'
 *
 * The password, when given, is the backups' restic password from the start,
 * so the host can keep a copy; blank, the box makes its own, as it does for
 * a destination an admin picks. Upkeep writes it all into the ops settings
 * (store.ts, applyGivenBackup), with backups on, and the Backups page shows
 * it as given and doesn't change it. A setting that can't be used is left
 * out whole, with a line in the log: the box then has no given destination.
 */
export interface GivenBackup {
  kind: Kind;
  fields: Values;
  secrets: Values;
  password?: string;
}

/** As long as the passwords the box makes for itself are not, but long enough. */
export const MIN_PASSWORD = 16;

const leftOut = (why: string) => {
  console.warn(`[ops] STADEUM_BACKUP_DESTINATION left out: ${why}`);
  return undefined;
};

export function givenBackup(
  raw = process.env.STADEUM_BACKUP_DESTINATION,
  rawPassword = process.env.STADEUM_BACKUP_PASSWORD,
): GivenBackup | undefined {
  if (!raw?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return leftOut("it is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return leftOut("it is not a JSON object.");
  const { kind, ...rest } = value as Record<string, unknown>;
  if (!isKind(kind)) return leftOut(`its kind is one of ${KINDS.join(", ")}.`);
  const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v === "string")) as Values;
  const checked = validate(kind, values);
  if (!checked.ok) return leftOut(checked.error);
  const password = rawPassword?.trim();
  if (password && password.length < MIN_PASSWORD) return leftOut(`STADEUM_BACKUP_PASSWORD is shorter than ${MIN_PASSWORD} characters.`);
  return { kind, fields: checked.fields, secrets: checked.secrets, ...(password ? { password } : {}) };
}

/** What an admin reads when they try to change a given destination. */
export const GIVEN_BACKUP_REFUSAL = "This box’s host gives its backup destination: it can’t be changed here.";
