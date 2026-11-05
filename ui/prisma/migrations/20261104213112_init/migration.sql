-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "actor" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'org',
    "macaroonOrgId" TEXT,
    "orgPubkey" TEXT,
    "orgPrivkeyEnc" TEXT,
    "bifrostAdminUser" TEXT,
    "bifrostAdminPassEnc" TEXT,
    "trustedPubkey" TEXT,
    "trustRegisteredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MothershipUser" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "userPubkey" TEXT,
    "userPrivkeyEnc" TEXT,
    "customerId" TEXT,
    "vkId" TEXT,
    "vkValueEnc" TEXT,
    "delegationId" TEXT,
    "delegationExp" DATETIME,
    "delegationStatus" TEXT,
    "delegationError" TEXT,
    "checkedAt" DATETIME,
    CONSTRAINT "MothershipUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_actor_key" ON "User"("actor");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_email_key" ON "Invite"("email");
