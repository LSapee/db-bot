-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "answer_source_type" AS ENUM ('GENERATED', 'REUSED');

-- CreateEnum
CREATE TYPE "day_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "lesson_question_status" AS ENUM ('PENDING', 'ANSWERED', 'REUSED');

-- CreateEnum
CREATE TYPE "plan_status" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "material_job_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('SUBMITTED', 'RESPONDED');

-- CreateTable
CREATE TABLE "discord_guilds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discord_guild_id" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Seoul',
    "main_channel_id" VARCHAR(50),
    "quiz_channel_id" VARCHAR(50),
    "answer_channel_id" VARCHAR(50),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "discord_guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guild_uuid" UUID NOT NULL,
    "discord_user_id" VARCHAR(50) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "discord_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guild_uuid" UUID NOT NULL,
    "creator_member_uuid" UUID NOT NULL,
    "goal_text" TEXT NOT NULL,
    "requested_range_text" TEXT,
    "total_days" INTEGER NOT NULL,
    "start_date" DATE,
    "current_day" INTEGER NOT NULL DEFAULT 0,
    "status" "plan_status" NOT NULL DEFAULT 'DRAFT',
    "outline_raw" JSONB,
    "plan_raw" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_plan_uuid" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "topic_summary" TEXT NOT NULL,
    "learning_goal" TEXT NOT NULL,
    "scope_text" TEXT,
    "status" "day_status" NOT NULL DEFAULT 'PENDING',
    "scheduled_date" DATE,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_day_material_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_plan_uuid" UUID NOT NULL,
    "study_day_uuid" UUID NOT NULL,
    "status" "material_job_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_text" TEXT,
    "last_attempted_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "study_day_material_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_contents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_day_uuid" UUID NOT NULL,
    "discord_message_id" VARCHAR(50),
    "summary_text" TEXT,
    "content_text" TEXT NOT NULL,
    "llm_raw" JSONB,
    "published_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "day_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_day_uuid" UUID NOT NULL,
    "member_uuid" UUID NOT NULL,
    "discord_channel_id" VARCHAR(50),
    "discord_message_id" VARCHAR(50),
    "question_text" TEXT NOT NULL,
    "normalized_text" TEXT,
    "status" "lesson_question_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "lesson_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_uuid" UUID NOT NULL,
    "answer_text" TEXT NOT NULL,
    "answer_source_type" "answer_source_type" NOT NULL DEFAULT 'GENERATED',
    "source_question_uuid" UUID,
    "discord_message_id" VARCHAR(50),
    "llm_raw" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "lesson_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_day_uuid" UUID NOT NULL,
    "discord_message_id" VARCHAR(50),
    "intro_text" TEXT,
    "published_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quiz_uuid" UUID NOT NULL,
    "question_no" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "expected_points" JSONB,
    "model_answer_text" TEXT NOT NULL,
    "explanation_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "quiz_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_hints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quiz_item_uuid" UUID NOT NULL,
    "hint_no" INTEGER NOT NULL,
    "hint_text" TEXT NOT NULL,
    "llm_raw" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "quiz_hints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quiz_item_uuid" UUID NOT NULL,
    "member_uuid" UUID NOT NULL,
    "discord_message_id" VARCHAR(50),
    "answer_text" TEXT NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_guilds_discord_guild_id_key" ON "discord_guilds"("discord_guild_id");

-- CreateIndex
CREATE INDEX "idx_discord_members_guild_uuid" ON "discord_members"("guild_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "uq_discord_members_guild_user" ON "discord_members"("guild_uuid", "discord_user_id");

-- CreateIndex
CREATE INDEX "idx_study_plans_guild_uuid" ON "study_plans"("guild_uuid");

-- CreateIndex
CREATE INDEX "idx_study_plans_creator_member_uuid" ON "study_plans"("creator_member_uuid");

-- CreateIndex
CREATE INDEX "idx_study_days_plan_uuid" ON "study_days"("study_plan_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "uq_study_days_plan_day" ON "study_days"("study_plan_uuid", "day_number");

-- CreateIndex
CREATE INDEX "idx_study_day_material_jobs_plan_uuid" ON "study_day_material_jobs"("study_plan_uuid");

-- CreateIndex
CREATE INDEX "idx_study_day_material_jobs_status_created_at" ON "study_day_material_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "study_day_material_jobs_study_day_uuid_key" ON "study_day_material_jobs"("study_day_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "day_contents_study_day_uuid_key" ON "day_contents"("study_day_uuid");

-- CreateIndex
CREATE INDEX "idx_lesson_questions_day_uuid" ON "lesson_questions"("study_day_uuid");

-- CreateIndex
CREATE INDEX "idx_lesson_questions_member_uuid" ON "lesson_questions"("member_uuid");

-- CreateIndex
CREATE INDEX "idx_lesson_answers_question_uuid" ON "lesson_answers"("question_uuid");

-- CreateIndex
CREATE INDEX "idx_lesson_answers_source_question_uuid" ON "lesson_answers"("source_question_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "quizzes_study_day_uuid_key" ON "quizzes"("study_day_uuid");

-- CreateIndex
CREATE INDEX "idx_quiz_items_quiz_uuid" ON "quiz_items"("quiz_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "uq_quiz_items_quiz_question_no" ON "quiz_items"("quiz_uuid", "question_no");

-- CreateIndex
CREATE INDEX "idx_quiz_hints_item_uuid" ON "quiz_hints"("quiz_item_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "uq_quiz_hints_item_hint_no" ON "quiz_hints"("quiz_item_uuid", "hint_no");

-- CreateIndex
CREATE INDEX "idx_submissions_quiz_item_uuid" ON "submissions"("quiz_item_uuid");

-- CreateIndex
CREATE INDEX "idx_submissions_member_uuid" ON "submissions"("member_uuid");

-- AddForeignKey
ALTER TABLE "discord_members" ADD CONSTRAINT "discord_members_guild_uuid_fkey" FOREIGN KEY ("guild_uuid") REFERENCES "discord_guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_creator_member_uuid_fkey" FOREIGN KEY ("creator_member_uuid") REFERENCES "discord_members"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_guild_uuid_fkey" FOREIGN KEY ("guild_uuid") REFERENCES "discord_guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_days" ADD CONSTRAINT "study_days_study_plan_uuid_fkey" FOREIGN KEY ("study_plan_uuid") REFERENCES "study_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_day_material_jobs" ADD CONSTRAINT "study_day_material_jobs_study_plan_uuid_fkey" FOREIGN KEY ("study_plan_uuid") REFERENCES "study_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "study_day_material_jobs" ADD CONSTRAINT "study_day_material_jobs_study_day_uuid_fkey" FOREIGN KEY ("study_day_uuid") REFERENCES "study_days"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "day_contents" ADD CONSTRAINT "day_contents_study_day_uuid_fkey" FOREIGN KEY ("study_day_uuid") REFERENCES "study_days"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_member_uuid_fkey" FOREIGN KEY ("member_uuid") REFERENCES "discord_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_study_day_uuid_fkey" FOREIGN KEY ("study_day_uuid") REFERENCES "study_days"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_answers" ADD CONSTRAINT "lesson_answers_question_uuid_fkey" FOREIGN KEY ("question_uuid") REFERENCES "lesson_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_answers" ADD CONSTRAINT "lesson_answers_source_question_uuid_fkey" FOREIGN KEY ("source_question_uuid") REFERENCES "lesson_questions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_study_day_uuid_fkey" FOREIGN KEY ("study_day_uuid") REFERENCES "study_days"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quiz_items" ADD CONSTRAINT "quiz_items_quiz_uuid_fkey" FOREIGN KEY ("quiz_uuid") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quiz_hints" ADD CONSTRAINT "quiz_hints_quiz_item_uuid_fkey" FOREIGN KEY ("quiz_item_uuid") REFERENCES "quiz_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_member_uuid_fkey" FOREIGN KEY ("member_uuid") REFERENCES "discord_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_quiz_item_uuid_fkey" FOREIGN KEY ("quiz_item_uuid") REFERENCES "quiz_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
