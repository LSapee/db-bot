import { Injectable } from '@nestjs/common';
import { toFile } from 'openai';
import { OpenAiClientService } from './client/openai-client.service';
import { OpenAiPlanService } from './plan/openai-plan.service';
import { OpenAiQuestionService } from './question/openai-question.service';
import { OpenAiReviewService } from './review/openai-review.service';

export type {
  GeneratedQuizItem,
  GeneratedStudyDayMaterials,
  GeneratedStudyPlan,
  GeneratedStudyPlanDay,
  GeneratedStudyQuestionAnswer,
} from './common/openai.types';

@Injectable()
export class OpenAiService {
  constructor(
    private readonly openAiClientService: OpenAiClientService,
    private readonly openAiPlanService: OpenAiPlanService,
    private readonly openAiQuestionService: OpenAiQuestionService,
    private readonly openAiReviewService: OpenAiReviewService,
  ) {}

  // Returns whether the OpenAI client can be used in the current environment.
  // 현재 환경에서 OpenAI 클라이언트를 사용할 수 있는지 반환한다.
  isConfigured() {
    return this.openAiClientService.isConfigured();
  }

  async startStudyDayMaterialsBatch(input: {
    customId: string;
    planTitle: string;
    goalText: string;
    selectedCourseName: string;
    studyDay: import('./common/openai.types').GeneratedStudyPlanDay;
  }) {
    const client = this.openAiClientService.requireClient();
    const requestBody = this.openAiPlanService.buildStudyDayMaterialsBatchRequest(
      input.planTitle,
      input.goalText,
      input.selectedCourseName,
      input.studyDay,
    );
    const inputLine = JSON.stringify({
      custom_id: input.customId,
      method: 'POST',
      url: '/v1/responses',
      body: requestBody,
    });

    const uploadedFile = await client.files.create({
      file: await toFile(
        Buffer.from(`${inputLine}\n`, 'utf-8'),
        `study-day-materials-${input.studyDay.dayNumber}.jsonl`,
      ),
      purpose: 'batch',
    });

    const createdBatch = await client.batches.create({
      input_file_id: uploadedFile.id,
      endpoint: '/v1/responses',
      completion_window: '24h',
      metadata: {
        source: 'discord-study-day-materials',
        study_day_number: String(input.studyDay.dayNumber),
      },
    });

    return {
      batchId: createdBatch.id,
      inputFileId: uploadedFile.id,
    };
  }

  async getStudyDayMaterialsBatchResult(batchId: string) {
    const client = this.openAiClientService.requireClient();
    const batch = await client.batches.retrieve(batchId);

    if (
      batch.status === 'validating' ||
      batch.status === 'in_progress' ||
      batch.status === 'finalizing' ||
      batch.status === 'cancelling'
    ) {
      return {
        status: 'PENDING' as const,
        batchStatus: batch.status,
      };
    }

    if (batch.status === 'completed' && batch.output_file_id) {
      const outputFileResponse = await client.files.content(batch.output_file_id);
      const outputText = await outputFileResponse.text();
      const parsedOutputText = this.parseBatchOutputText(outputText);

      if (!parsedOutputText) {
        return {
          status: 'FAILED' as const,
          detail: '배치 결과 텍스트를 추출하지 못했습니다.',
          batchStatus: batch.status,
        };
      }

      return {
        status: 'COMPLETED' as const,
        batchStatus: batch.status,
        generatedMaterials: this.openAiPlanService.parseStudyDayMaterialsBatchOutput(
          parsedOutputText,
        ),
      };
    }

    return {
      status: 'FAILED' as const,
      batchStatus: batch.status,
      detail:
        batch.errors?.data?.map((error) => error.message).filter(Boolean).join(' | ') ||
        `배치 상태: ${batch.status}`,
    };
  }

  // Delegates study-direction generation to the planning-focused OpenAI service.
  // 학습 방향성 생성 요청을 계획 전용 OpenAI 서비스에 위임한다.
  async getStudyDirection(days: number) {
    return this.openAiPlanService.getStudyDirection(days);
  }

  // Delegates single-course preview generation to the planning-focused OpenAI service.
  // 선택한 난이도 하나에 대한 간단 일정 생성 요청을 계획 전용 OpenAI 서비스에 위임한다.
  async getStudyCoursePreview(days: number, selectedCourseName: string) {
    return this.openAiPlanService.getStudyCoursePreview(days, selectedCourseName);
  }

  // Delegates detailed study-plan generation to the planning-focused OpenAI service.
  // 상세 학습 계획 생성 요청을 계획 전용 OpenAI 서비스에 위임한다.
  async getDetailedStudyPlan(
    days: number,
    selectedCourseName: string,
    selectedCourseContent: string,
  ) {
    return this.openAiPlanService.getDetailedStudyPlan(
      days,
      selectedCourseName,
      selectedCourseContent,
    );
  }

  // Delegates day-material generation to the planning-focused OpenAI service.
  // 일차별 학습 자료 생성 요청을 계획 전용 OpenAI 서비스에 위임한다.
  async getStudyDayMaterials(
    planTitle: string,
    goalText: string,
    selectedCourseName: string,
    studyDay: import('./common/openai.types').GeneratedStudyPlanDay,
  ) {
    return this.openAiPlanService.getStudyDayMaterials(
      planTitle,
      goalText,
      selectedCourseName,
      studyDay,
    );
  }

  // Delegates study-question answering to the question-focused OpenAI service.
  // 학습 질문 응답 요청을 질문 전용 OpenAI 서비스에 위임한다.
  async answerStudyQuestion(questionText: string, contextText: string) {
    return this.openAiQuestionService.answerStudyQuestion(questionText, contextText);
  }

  // Delegates submission review to the review-focused OpenAI service.
  // 제출 답안 검토 요청을 리뷰 전용 OpenAI 서비스에 위임한다.
  async reviewQuizSubmission(
    questionNo: number,
    promptText: string,
    modelAnswerText: string,
    explanationText: string,
    userAnswerText: string,
  ) {
    return this.openAiReviewService.reviewQuizSubmission(
      questionNo,
      promptText,
      modelAnswerText,
      explanationText,
      userAnswerText,
    );
  }

  private parseBatchOutputText(rawFileContent: string) {
    const firstLine = rawFileContent
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);

    if (!firstLine) {
      return null;
    }

    const parsedLine = JSON.parse(firstLine) as {
      error?: {
        message?: string;
      } | null;
      response?: {
        body?: {
          output_text?: string;
          output?: Array<{
            type?: string;
            content?: Array<{
              type?: string;
              text?: string;
            }>;
          }>;
        };
      } | null;
    };

    if (parsedLine.error?.message) {
      return parsedLine.error.message;
    }

    if (typeof parsedLine.response?.body?.output_text === 'string') {
      return parsedLine.response.body.output_text.trim();
    }

    const firstOutputText = parsedLine.response?.body?.output
      ?.flatMap((outputItem) => outputItem.content ?? [])
      .find((contentItem) => contentItem.type === 'output_text' && typeof contentItem.text === 'string');

    return firstOutputText?.text?.trim() ?? null;
  }
}
