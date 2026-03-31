-- AlterTable
ALTER TABLE "study_days"
ADD COLUMN "user_answer_thread_id" VARCHAR(50),
ADD COLUMN "user_ask_thread_id" VARCHAR(50);

-- CreateIndex
CREATE UNIQUE INDEX "study_days_user_answer_thread_id_key" ON "study_days"("user_answer_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_days_user_ask_thread_id_key" ON "study_days"("user_ask_thread_id");
