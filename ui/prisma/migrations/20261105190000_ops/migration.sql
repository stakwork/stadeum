-- The box's upkeep: ops's settings, its status, the admin's requests and
-- what it did.
CREATE TABLE "OpsSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'ops',
    "windowStart" TEXT NOT NULL DEFAULT '03:00',
    "windowEnd" TEXT NOT NULL DEFAULT '05:00',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "drainMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "backupsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "backupKind" TEXT,
    "backupFields" TEXT,
    "backupSecretsEnc" TEXT,
    "resticPasswordEnc" TEXT,
    "passwordKeptAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "OpsStatus" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'ops',
    "state" TEXT NOT NULL,
    "lastCycle" TEXT,
    "reportedAt" DATETIME NOT NULL
);

CREATE TABLE "OpsRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" DATETIME
);

CREATE TABLE "OpsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "detail" TEXT NOT NULL,
    "changes" TEXT,
    "snapshotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "OpsEvent_kind_endedAt_idx" ON "OpsEvent"("kind", "endedAt");
