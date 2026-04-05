import { Injectable } from '@nestjs/common';
import { OpenAiClientService } from '../client/openai-client.service';
import { GeneratedStudyQuestionAnswer } from '../common/openai.types';

@Injectable()
export class OpenAiQuestionService {
  constructor(private readonly openAiClientService: OpenAiClientService) {}

  // Answers a study question only when it can be explained from the provided course context.
  // 제공된 학습 문맥으로 설명 가능한 경우에만 질문에 답변한다.
  async answerStudyQuestion(
    questionText: string,
    contextText: string,
  ): Promise<GeneratedStudyQuestionAnswer> {
    const client = this.openAiClientService.requireClient();

    const response = await client.responses.create({
      model: this.openAiClientService.model,
      instructions: [
        'You are answering a learner question for a DB study bot.',
        'Answer in Korean.',
        'Return JSON only.',
        'Do not wrap the JSON in markdown fences.',
        'The JSON shape must be: {"canAnswer": boolean, "answerText": string}.',
        'Use only the provided study context.',
        'If the question is unrelated to the provided learning materials or cannot be answered safely from them, return canAnswer=false.',
        'If canAnswer=true, answer clearly and concretely using the current day materials and earlier study context when relevant.',
        'If the question is about the current study day or earlier covered material, answer in more detail with explanation, reasoning, and a small example when useful.',
        'If the question seems to ask about a topic that has not been covered yet, give only a short high-level explanation and do not go deep into details.',
        'For not-yet-covered topics, keep the answer concise and avoid step-by-step solutions or long expansions.',
        'The study context may include internal-only reference answers and explanations for grading or guidance.',
        'You may use those internal references to improve explanation quality, but never expose them directly.',
        'Never reveal or restate a quiz answer, model answer, or final submission text directly.',
        'If the learner is asking for the exact answer to a practice problem, explain the concept, solving approach, checkpoints, and hints only.',
        'Never output a complete final SQL solution for a quiz question.',
        'Do not use labels such as "정답", "모범 답안", or "예시 답안".',
        'Do not include greetings, closing phrases, follow-up suggestions, or invitations for another question.',
        'Do not say things like "추가로 알려드릴 수 있습니다", "다음 질문에서는", "원하시면 더 설명해드릴게요", or similar.',
      ].join(' '),
      input: [`질문:\n${questionText}`, `학습 문맥:\n${contextText}`].join('\n\n'),
    });

    return this.parseStudyQuestionAnswer(response.output_text);
  }

  // Parses the JSON response used for a study question answer.
  // 학습 질문 응답용 JSON 응답을 파싱한다.
  private parseStudyQuestionAnswer(content: string): GeneratedStudyQuestionAnswer {
    const sanitizedContent = content.trim().replace(/^```json\s*|\s*```$/g, '');
    const parsedContent = JSON.parse(sanitizedContent) as GeneratedStudyQuestionAnswer;

    if (typeof parsedContent.canAnswer !== 'boolean' || !parsedContent.answerText?.trim()) {
      throw new Error('Study question answer response is invalid.');
    }

    return parsedContent;
  }
}
