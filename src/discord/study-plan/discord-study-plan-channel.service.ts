import { Injectable } from '@nestjs/common';
import { Message } from 'discord.js';
import { DiscordStudyPlanService } from './discord-study-plan.service';

@Injectable()
export class DiscordStudyPlanChannelService {
  constructor(private readonly discordStudyPlanService: DiscordStudyPlanService) {}

  // Handles all messages that come through the db_study_plan text channel.
  // db_study_plan 텍스트 채널로 들어오는 모든 메시지를 처리한다.
  async handleMessage(message: Message) {
    await this.discordStudyPlanService.handleDurationReply(message);
  }
}
