-- AlterTable
ALTER TABLE "study_day_material_jobs"
ADD COLUMN "study_day_number" INTEGER,
ADD COLUMN "generation_mode" VARCHAR(20),
ADD COLUMN "batch_id" VARCHAR(100),
ADD COLUMN "batch_status" VARCHAR(30),
ADD COLUMN "requested_at" TIMESTAMP(6),
ADD COLUMN "deadline_at" TIMESTAMP(6),
ADD COLUMN "ready_at" TIMESTAMP(6),
ADD COLUMN "fallback_attempted_at" TIMESTAMP(6);

-- Backfill
UPDATE "study_day_material_jobs" AS job
SET "study_day_number" = day."day_number"
FROM "study_days" AS day
WHERE day."id" = job."study_day_uuid"
  AND job."study_day_number" IS NULL;

-- SetNotNull
ALTER TABLE "study_day_material_jobs"
ALTER COLUMN "study_day_number" SET NOT NULL;

-- CreateIndex
CREATE INDEX "idx_study_day_material_jobs_day_number" ON "study_day_material_jobs"("study_day_number");
