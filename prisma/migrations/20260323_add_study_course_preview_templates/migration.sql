-- CreateTable
CREATE TABLE "study_course_preview_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "total_days" INTEGER NOT NULL,
    "course_name" VARCHAR(20) NOT NULL,
    "prompt_version" INTEGER NOT NULL DEFAULT 1,
    "content_text" TEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_course_preview_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_study_course_preview_templates_lookup"
ON "study_course_preview_templates"("total_days", "course_name", "prompt_version", "created_at");
