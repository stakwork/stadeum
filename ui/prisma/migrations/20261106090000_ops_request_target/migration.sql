-- An admin's confirmation of a held release (Upgrade Neo4j) names what
-- they agreed to: ops moves only to those image references.
ALTER TABLE "OpsRequest" ADD COLUMN "target" TEXT;
