-- CreateTable
CREATE TABLE "LimitChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "byEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
