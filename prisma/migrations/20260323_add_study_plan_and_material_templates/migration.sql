-- CreateTable
CREATE TABLE "study_plan_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_preview_template_uuid" UUID NOT NULL,
    "prompt_version" INTEGER NOT NULL DEFAULT 1,
    "plan_title" VARCHAR(255) NOT NULL,
    "goal_text" TEXT NOT NULL,
    "plan_raw" JSONB NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_plan_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_day_material_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_plan_template_uuid" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "materials_raw" JSONB NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_day_material_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_study_plan_templates_lookup"
ON "study_plan_templates"("course_preview_template_uuid", "prompt_version", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_study_day_material_templates_plan_day"
ON "study_day_material_templates"("study_plan_template_uuid", "day_number");

-- CreateIndex
CREATE INDEX "idx_study_day_material_templates_lookup"
ON "study_day_material_templates"("study_plan_template_uuid", "day_number", "created_at");

-- AddForeignKey
ALTER TABLE "study_plan_templates"
ADD CONSTRAINT "study_plan_templates_course_preview_template_uuid_fkey"
FOREIGN KEY ("course_preview_template_uuid") REFERENCES "study_course_preview_templates"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_day_material_templates"
ADD CONSTRAINT "study_day_material_templates_study_plan_template_uuid_fkey"
FOREIGN KEY ("study_plan_template_uuid") REFERENCES "study_plan_templates"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;
