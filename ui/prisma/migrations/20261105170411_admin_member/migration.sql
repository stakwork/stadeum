-- Two roles: admin and member. Owner and admin become admin; any other
-- value (the old six-role set included) becomes member.
UPDATE "User" SET "role" = CASE WHEN "role" IN ('owner', 'admin') THEN 'admin' ELSE 'member' END;
UPDATE "Invite" SET "role" = CASE WHEN "role" IN ('owner', 'admin') THEN 'admin' ELSE 'member' END;
