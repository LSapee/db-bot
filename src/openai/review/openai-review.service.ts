import { Injectable } from '@nestjs/common';
import { OpenAiClientService } from '../client/openai-client.service';

@Injectable()
export class OpenAiReviewService {
  constructor(private readonly openAiClientService: OpenAiClientService) {}

  // Compares a user's submission with the generated model answer and returns learner-facing feedback
  // without revealing the full model answer.
  // 사용자의 제출 답안을 생성된 모범 답안과 비교하되, 모범 답안을 노출하지 않는 학습자용 피드백을 반환한다.
  async reviewQuizSubmission(
    questionNo: number,
    promptText: string,
    modelAnswerText: string,
    explanationText: string,
    userAnswerText: string,
  ) {
    const client = this.openAiClientService.requireClient();

    const response = await client.responses.create({
      model: this.openAiClientService.model,
      instructions: [
        'You are reviewing a learner submission for a DB study bot.',
        'Answer in Korean.',
        'Be concise, concrete, and instructional.',
        'Do not include greetings, encouragement, or wrap-up questions.',
        'Do not use markdown headings or markdown tables.',
        'Use plain text only.',
        'Explain whether the submission is correct, partially correct, or incorrect.',
        'If the answer is a SQL query, compare intent, syntax, filtering, joins, and result correctness.',
        'Never reveal, quote, or restate the full model answer.',
        'Never output a full corrected SQL query or final answer text.',
        'Do not use labels such as "모범 답안", "정답", or "예시 답안".',
        'Instead, explain what is correct, what is missing, and what should be fixed conceptually.',
        'Use the stored explanation only as internal reference for feedback.',
      ].join(' '),
      input: [
        `문제 번호: ${questionNo}`,
        `문제 본문:\n${promptText}`,
        `모범 답안:\n${modelAnswerText}`,
        `문제 해설:\n${explanationText}`,
        `사용자 제출 답안:\n${userAnswerText}`,
        '사용자에게 보여줄 검토 결과를 작성해주세요.',
        '모범 답안은 내부 비교용으로만 사용하고, 사용자에게 직접 보여주지 마세요.',
      ].join('\n\n'),
    });

    return response.output_text.trim();
  }
}
