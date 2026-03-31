import { Global, Module } from '@nestjs/common';
import { OpenAiClientService } from './client/openai-client.service';
import { OpenAiPlanService } from './plan/openai-plan.service';
import { OpenAiQuestionService } from './question/openai-question.service';
import { OpenAiReviewService } from './review/openai-review.service';
import { OpenAiService } from './openai.service';

@Global()
@Module({
  providers: [
    OpenAiClientService,
    OpenAiPlanService,
    OpenAiQuestionService,
    OpenAiReviewService,
    OpenAiService,
  ],
  exports: [OpenAiService],
})
export class OpenAiModule {}
