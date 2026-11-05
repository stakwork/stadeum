/**
 * What ops and stadeum-ui say to each other. ops starts every call: it
 * reads its settings, and posts its status and what it did. Every call
 * carries `Authorization: Bearer <SHARED_API_TOKEN>`. stadeum-ui keeps a
 * copy of these types in `ui/src/lib/ops/contract.ts`; change both.
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

export type RequestKind = "check" | "update" | "backup";

export interface OpsSettings {
  window: UpkeepWindow;
  /** How long to wait for strut to go idle before a restart; what still runs then resumes after it. */
  drainMinutes: number;
  updates: { enabled: boolean };
  /** null until the admin picks a destination. */
  backups: ({ enabled: boolean } & Destination) | null;
  /** What an admin asked for on the Updates and Backups pages, oldest first. */
  requests: Array<{ id: string; kind: RequestKind; at: string }>;
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
  running?: ImageRef;
  available?: ImageRef;
}

export interface ImageRef {
  /** The image ID (`sha256:…`). */
  id: string;
  /** Its `org.opencontainers.image.revision` label: the commit it was built from. */
  revision?: string;
  created?: string;
}

export interface Snapshot {
  id: string;
  time: string;
  /** Bytes the backup added to the repository, when ops made it. */
  added?: number;
}

export interface OpsStatus {
  phase: Phase;
  detail?: string;
  /** ops's own revision. */
  version: string;
  services: ServiceImage[];
  /** When ops last compared the channels with what runs. */
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
