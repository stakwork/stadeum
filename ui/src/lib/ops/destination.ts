/**
 * Where backups go: the destinations restic speaks, each as the fields the
 * Backups page asks for, turned into restic's repository string and the
 * variables it reads its credentials from (restic's own names, so the same
 * lines work in a restore kit on a fresh box). Nothing here is cloud-specific
 * beyond restic's backends.
 */

export const KINDS = ["s3", "azure", "gcs", "b2", "local"] as const;
export type Kind = (typeof KINDS)[number];
export const isKind = (k: unknown): k is Kind => typeof k === "string" && (KINDS as readonly string[]).includes(k);

export interface Field {
  name: string;
  label: string;
  /** Kept encrypted, never shown again: the page says it is saved. */
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
}

export interface DestinationKind {
  label: string;
  hint: string;
  fields: Field[];
}

const folder: Field = { name: "path", label: "Folder", optional: true, placeholder: "stadeum", hint: "Inside the bucket; blank for its root" };

export const DESTINATIONS: Record<Kind, DestinationKind> = {
  s3: {
    label: "S3 or S3-compatible",
    hint: "Amazon S3, Cloudflare R2, MinIO, Wasabi and the like",
    fields: [
      {
        name: "endpoint",
        label: "Endpoint",
        optional: true,
        placeholder: "https://<account>.r2.cloudflarestorage.com",
        hint: "Blank for Amazon S3",
      },
      { name: "bucket", label: "Bucket" },
      folder,
      { name: "region", label: "Region", optional: true, placeholder: "us-east-1" },
      { name: "accessKeyId", label: "Access key ID", secret: true },
      { name: "secretAccessKey", label: "Secret access key", secret: true },
    ],
  },
  azure: {
    label: "Azure Blob Storage",
    hint: "A storage account's container",
    fields: [
      { name: "account", label: "Storage account" },
      { name: "container", label: "Container" },
      folder,
      { name: "accountKey", label: "Account key", secret: true },
    ],
  },
  gcs: {
    label: "Google Cloud Storage",
    hint: "A bucket, with a service account that can write to it",
    fields: [
      { name: "projectId", label: "Project ID" },
      { name: "bucket", label: "Bucket" },
      folder,
      { name: "serviceAccountKey", label: "Service account key (JSON)", secret: true, multiline: true },
    ],
  },
  b2: {
    label: "Backblaze B2",
    hint: "A bucket and an application key for it",
    fields: [
      { name: "bucket", label: "Bucket" },
      folder,
      { name: "keyId", label: "Key ID", secret: true },
      { name: "applicationKey", label: "Application key", secret: true },
    ],
  },
  local: {
    label: "A folder on this box",
    hint: "For trying backups out, or a disk mounted at backups/ beside the checkout. It is not off the box.",
    fields: [{ name: "path", label: "Folder", placeholder: "/backups/stadeum", hint: "Under /backups (the checkout's backups/ folder)" }],
  },
};

export type Values = Record<string, string>;

export interface Built {
  repository: string;
  env: Record<string, string>;
}

const slashes = (p: string | undefined) => (p ?? "").trim().replace(/^\/+|\/+$/g, "");

/** The fields an admin filled in, split into what is secret and what is not. Errors name the field. */
export function validate(kind: Kind, values: Values): { ok: true; fields: Values; secrets: Values } | { ok: false; error: string } {
  const fields: Values = {};
  const secrets: Values = {};
  for (const f of DESTINATIONS[kind].fields) {
    const v = (values[f.name] ?? "").trim();
    if (!v && !f.optional) return { ok: false, error: `${f.label} is needed.` };
    if (v) (f.secret ? secrets : fields)[f.name] = v;
  }
  if (kind === "s3" && fields.endpoint && !/^https?:\/\/[^/\s]+\/?$/.test(fields.endpoint)) {
    return { ok: false, error: "Endpoint is an origin, like https://s3.example.com (no path)." };
  }
  if (kind === "local") {
    const p = `/${slashes(fields.path)}`;
    if (!/^\/backups\/[A-Za-z0-9._-][A-Za-z0-9._/-]*$/.test(p) || p.split("/").includes("..")) {
      return { ok: false, error: "The folder must be under /backups, like /backups/stadeum." };
    }
    fields.path = p;
  }
  if (kind === "gcs" && secrets.serviceAccountKey) {
    try {
      JSON.parse(secrets.serviceAccountKey);
    } catch {
      return { ok: false, error: "The service account key is not JSON: paste the whole key file." };
    }
  }
  for (const f of ["bucket", "container"]) {
    if (fields[f] && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields[f])) return { ok: false, error: `That ${f} name has characters it cannot have.` };
  }
  return { ok: true, fields, secrets };
}

/** restic's repository and variables for a destination. */
export function build(kind: Kind, fields: Values, secrets: Values): Built {
  const path = slashes(fields.path);
  switch (kind) {
    case "s3": {
      const endpoint = (fields.endpoint ?? "").replace(/\/+$/, "") || "s3.amazonaws.com";
      return {
        repository: `s3:${endpoint}/${fields.bucket}${path ? `/${path}` : ""}`,
        env: {
          AWS_ACCESS_KEY_ID: secrets.accessKeyId ?? "",
          AWS_SECRET_ACCESS_KEY: secrets.secretAccessKey ?? "",
          ...(fields.region ? { AWS_DEFAULT_REGION: fields.region } : {}),
        },
      };
    }
    case "azure":
      return {
        repository: `azure:${fields.container}:/${path}`,
        env: { AZURE_ACCOUNT_NAME: fields.account ?? "", AZURE_ACCOUNT_KEY: secrets.accountKey ?? "" },
      };
    case "gcs":
      return {
        repository: `gs:${fields.bucket}:/${path}`,
        env: { GOOGLE_PROJECT_ID: fields.projectId ?? "", GOOGLE_APPLICATION_CREDENTIALS_JSON: secrets.serviceAccountKey ?? "" },
      };
    case "b2":
      return {
        repository: `b2:${fields.bucket}:${path}`,
        env: { B2_ACCOUNT_ID: secrets.keyId ?? "", B2_ACCOUNT_KEY: secrets.applicationKey ?? "" },
      };
    case "local":
      return { repository: fields.path ?? "/backups/stadeum", env: {} };
  }
}

/**
 * The restore kit: what a fresh box needs to read the backups, as an env
 * file for `docker compose run --env-from-file`. The password is in it;
 * the storage credentials are named for the admin to fill in, since they
 * have them already and they need not be copied again.
 */
export function restoreKit(kind: Kind, built: Built, password: string): string {
  const credentials = Object.keys(built.env)
    .filter((k) => !["AWS_DEFAULT_REGION", "AZURE_ACCOUNT_NAME", "GOOGLE_PROJECT_ID"].includes(k))
    .map((k) => (k === "GOOGLE_APPLICATION_CREDENTIALS_JSON" ? `${k}=<the key file, as: base64 < key.json>` : `${k}=<yours>`));
  const plain = Object.entries(built.env)
    .filter(([k]) => ["AWS_DEFAULT_REGION", "AZURE_ACCOUNT_NAME", "GOOGLE_PROJECT_ID"].includes(k))
    .map(([k, v]) => `${k}=${v}`);
  return [
    "# stadeum restore kit. Keep it off the box (a password manager).",
    "# Without RESTIC_PASSWORD the backups cannot be read by anyone.",
    "# On a fresh box, in the checkout: scripts/init-env.sh, then",
    "#   docker compose --env-file .env -f stack/stadeum.yml run --rm --env-from-file restore.env ops restore",
    `RESTIC_REPOSITORY=${built.repository}`,
    `RESTIC_PASSWORD=${password}`,
    ...plain,
    ...credentials,
    ...(kind === "local" ? ["# A folder on the old box: copy it to the new box's backups/ first."] : []),
    "",
  ].join("\n");
}
