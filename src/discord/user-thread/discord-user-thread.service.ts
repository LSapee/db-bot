import { Injectable } from '@nestjs/common';
import { Message } from 'discord.js';
import { DiscordStudyPlanService } from '../study-plan/discord-study-plan.service';

@Injectable()
export class DiscordUserThreadService {
  constructor(private readonly discordStudyPlanService: DiscordStudyPlanService) {}

  // Handles learner answer submissions posted inside user_answer threads.
  // user_answer 스레드 안에 올라온 학습자 제출 메시지를 처리한다.
  async handleAnswerSubmission(message: Message) {
    await this.discordStudyPlanService.handleUserAnswerSubmission(message);
  }

  // Handles learner questions posted inside user_ask threads.
  // user_ask 스레드 안에 올라온 학습자 질문 메시지를 처리한다.
  async handleQuestion(message: Message) {
    await this.discordStudyPlanService.handleUserAskQuestion(message);
  }
}
