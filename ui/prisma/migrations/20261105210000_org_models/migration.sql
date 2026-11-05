-- The org's model list and default (docs/models.md). Null until an admin
-- saves them on the Models page.
ALTER TABLE "Org" ADD COLUMN "models" TEXT;
ALTER TABLE "Org" ADD COLUMN "defaultModel" TEXT;
