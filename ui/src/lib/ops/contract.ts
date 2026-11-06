/**
 * What ops and stadeum-ui say to each other. ops starts every call: it
 * reads its settings, and posts its status and what it did. Every call
 * carries `Authorization: Bearer <SHARED_API_TOKEN>`. A copy of
 * `ops/src/contract.ts` (the two packages build apart); change both.
 *
 *   GET  /api/ops/settings  → OpsSettings
 *   PUT  /api/ops/status    ← OpsStatus
 *   POST /api/ops/history   ← OpsEvent
 */

/** The daily window updates and backups run in: `HH:MM`, IANA time zone. */
export interface UpkeepWindow {
  start: string;
  end: string;
  timeZone: string;
}

/** A restic repository and what restic needs to open it. */
export interface Destination {
  /** restic's `-r`: `s3:…`, `azure:…`, `gs:…`, `b2:…` or a path. */
  repository: string;
  password: string;
  /**
   * The backend's credentials, as restic's own variables
   * (`AWS_ACCESS_KEY_ID`, `AZURE_ACCOUNT_KEY`, `B2_ACCOUNT_ID`, …).
   * `GOOGLE_APPLICATION_CREDENTIALS_JSON` carries a service account's key
   * file itself; ops writes it to a file for restic.
   */
  env: Record<string, string>;
}

/**
 * `confirm`: an admin let a held release in (Upgrade Neo4j). Its `target`
 * names the image references they agreed to, comma-separated: ops backs
 * up, then moves only to those.
 */
export type RequestKind = "check" | "update" | "backup" | "confirm";

export interface OpsSettings {
  window: UpkeepWindow;
  /** How long to wait for strut to go idle before a restart; what still runs then resumes after it. */
  drainMinutes: number;
  updates: { enabled: boolean };
  /** null until the admin picks a destination. */
  backups: ({ enabled: boolean } & Destination) | null;
  /** What an admin asked for on the Updates and Backups pages, oldest first. */
  requests: Array<{ id: string; kind: RequestKind; at: string; target?: string }>;
  /** The window ops last ran its daily pass in (its local start date). */
  lastCycle: string | null;
  /** Images that failed their health check: not tried again until the channel moves on. */
  failedImages: string[];
}

export type Phase = "idle" | "checking" | "draining" | "backing-up" | "updating" | "rolling-back" | "restoring";

/** One service's image: what runs and, for a service ops moves, what its channel has. */
export interface ServiceImage {
  service: string;
  /** The reference the compose file gives, e.g. `ghcr.io/stakwork/strut:stable`. */
  image: string;
  /** The update group ops moves it in (its `stadeum.ops.update` label); absent: a person moves it. */
  group?: string;
  /** Built on this box (`stack/dev.yml`): never pulled. */
  built?: boolean;
  /** One of stadeum's release's own images (stadeum-ui, ops): it moves with the release. */
  release?: boolean;
  running?: ImageRef;
  /** What the channel had at the last pull, when it is not what runs: here, not yet running. */
  available?: ImageRef;
  /** What the registry says the reference names now: for a service ops moves. */
  latest?: Latest;
}

export interface ImageRef {
  /** The image ID (`sha256:…`). */
  id: string;
  /** Its `org.opencontainers.image.revision` label: the commit it was built from. */
  revision?: string;
  created?: string;
  /** The registry digests it was pulled as (its RepoDigests): a multi-arch image's index. */
  digests?: string[];
}

/**
 * What a service's registry said its tag names, the last time ops asked
 * (every 10 minutes, on Check now, and after an update). Nothing else
 * makes the page call an image current.
 */
export interface Latest {
  /** When the registry last answered. */
  checkedAt?: string;
  /** The digest the tag named then. */
  digest?: string;
  /** Whether that is what runs: the running image was pulled as that digest. */
  current?: boolean;
  /** When it is not: what the newer image says of itself. */
  revision?: string;
  created?: string;
  /** Why the last try told nothing (the registry failed, or what runs has no digest), and when it was. */
  problem?: string;
  triedAt?: string;
}

export interface Snapshot {
  id: string;
  time: string;
  /** Bytes the backup added to the repository, when ops made it. */
  added?: number;
}

/**
 * A stadeum release: stadeum-ops's image, the stack files it carries, and
 * stadeum-ui's image, moved together. What runs, and what the channel has
 * when that is another.
 */
export interface ReleaseStatus {
  /** ops's image that runs: its revision is the release's commit. */
  running?: ImageRef;
  /** The channel's, when it is not the one that runs. */
  available?: ImageRef;
  /** What moving to it changes: the stack files, and each service whose image reference changes. */
  files?: string[];
  images?: Array<{ service: string; from?: string; to?: string }>;
  /**
   * What holds it: a service whose image moves only when an admin
   * confirms it, after a backup, because it cannot move back (Neo4j).
   */
  held?: Array<{ service: string; from: string; to: string }>;
  /** Why the channel's release could not be read. */
  problem?: string;
}

export interface OpsStatus {
  phase: Phase;
  detail?: string;
  /** ops's own revision. */
  version: string;
  services: ServiceImage[];
  release?: ReleaseStatus;
  /** When ops last asked the registries what the channels name. */
  checkedAt?: string;
  lastCycle?: string;
  /** The newest snapshots in the repository, newest first. */
  snapshots?: Snapshot[];
  /** The requests this status answers: stadeum-ui marks them done. */
  done?: string[];
}

export type EventKind = "update" | "backup" | "restore";
export type Outcome = "ok" | "failed" | "rolled-back" | "skipped";

export interface OpsEvent {
  kind: EventKind;
  outcome: Outcome;
  startedAt: string;
  endedAt: string;
  /** One sentence a person reads. */
  detail: string;
  /** What moved: one entry per service whose image changed. */
  changes?: Array<{ service: string; from?: ImageRef; to: ImageRef }>;
  snapshot?: Snapshot;
}
