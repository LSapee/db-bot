CREATE TABLE IF NOT EXISTS "discord_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discord_user_id" VARCHAR(50) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_users_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "discord_guilds"
ADD COLUMN IF NOT EXISTS "owner_discord_user_uuid" UUID;

ALTER TABLE "discord_members"
ADD COLUMN IF NOT EXISTS "discord_user_uuid" UUID;

DO $$
BEGIN
    CREATE TYPE "course_generation_usage_type" AS ENUM ('COURSE_PREVIEW', 'DETAILED_PLAN');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "course_generation_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discord_user_uuid" UUID NOT NULL,
    "usage_date" DATE NOT NULL,
    "usage_type" "course_generation_usage_type" NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_generation_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "discord_users_discord_user_id_key" ON "discord_users"("discord_user_id");
CREATE INDEX IF NOT EXISTS "idx_discord_guilds_owner_discord_user_uuid" ON "discord_guilds"("owner_discord_user_uuid");
CREATE INDEX IF NOT EXISTS "idx_discord_members_discord_user_uuid" ON "discord_members"("discord_user_uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_course_generation_usages_user_date_type"
ON "course_generation_usages"("discord_user_uuid", "usage_date", "usage_type");
CREATE INDEX IF NOT EXISTS "idx_course_generation_usages_date_type"
ON "course_generation_usages"("usage_date", "usage_type");

INSERT INTO "discord_users" (
    "id",
    "discord_user_id",
    "username",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    seeded."discord_user_id",
    seeded."username",
    seeded."created_at",
    seeded."updated_at"
FROM (
    SELECT DISTINCT ON ("discord_user_id")
        "discord_user_id",
        "username",
        "created_at",
        "updated_at"
    FROM (
        SELECT
            "discord_user_id",
            "username",
            "created_at",
            "updated_at"
        FROM "discord_members"

        UNION ALL

        SELECT
            "owner_discord_user_id" AS "discord_user_id",
            "owner_discord_user_id" AS "username",
            "created_at",
            "updated_at"
        FROM "discord_guilds"
        WHERE "owner_discord_user_id" IS NOT NULL
    ) AS combined
    WHERE "discord_user_id" IS NOT NULL
    ORDER BY "discord_user_id", "updated_at" DESC, "created_at" DESC
) AS seeded
ON CONFLICT ("discord_user_id") DO UPDATE
SET
    "username" = EXCLUDED."username",
    "updated_at" = EXCLUDED."updated_at";

UPDATE "discord_members" AS dm
SET "discord_user_uuid" = du."id"
FROM "discord_users" AS du
WHERE dm."discord_user_id" = du."discord_user_id";

UPDATE "discord_guilds" AS dg
SET "owner_discord_user_uuid" = du."id"
FROM "discord_users" AS du
WHERE dg."owner_discord_user_id" = du."discord_user_id";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'discord_guilds_owner_discord_user_uuid_fkey'
    ) THEN
        ALTER TABLE "discord_guilds"
        ADD CONSTRAINT "discord_guilds_owner_discord_user_uuid_fkey"
        FOREIGN KEY ("owner_discord_user_uuid") REFERENCES "discord_users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'discord_members_discord_user_uuid_fkey'
    ) THEN
        ALTER TABLE "discord_members"
        ADD CONSTRAINT "discord_members_discord_user_uuid_fkey"
        FOREIGN KEY ("discord_user_uuid") REFERENCES "discord_users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'course_generation_usages_discord_user_uuid_fkey'
    ) THEN
        ALTER TABLE "course_generation_usages"
        ADD CONSTRAINT "course_generation_usages_discord_user_uuid_fkey"
        FOREIGN KEY ("discord_user_uuid") REFERENCES "discord_users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;
