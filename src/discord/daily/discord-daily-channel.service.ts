import { Injectable } from '@nestjs/common';
import { Guild, Message } from 'discord.js';
import { DiscordStudyPlanService } from '../study-plan/discord-study-plan.service';

@Injectable()
export class DiscordDailyChannelService {
  constructor(private readonly discordStudyPlanService: DiscordStudyPlanService) {}

  // Handles read-only messages posted inside tutor, quiz, hint, or answer threads.
  // tutor, quiz, hint, answer 스레드에 올라온 읽기 전용 위반 메시지를 처리한다.
  async handleReadOnlyMessage(message: Message) {
    await this.discordStudyPlanService.handleReadOnlyDailyThreadMessage(message);
  }

  // Runs the timed daily automation for one guild.
  // 하나의 서버에 대해 시간 기반 일일 자동화를 실행한다.
  async processAutomatedStudyPlans(guild: Guild) {
    await this.discordStudyPlanService.processAutomatedStudyPlans(guild);
  }

  // Runs queued study-day material generation jobs for one guild.
  // 하나의 서버에 대해 큐에 쌓인 학습 자료 생성 작업을 실행한다.
  async processQueuedStudyDayMaterialJobs(guild: Guild) {
    await this.discordStudyPlanService.processQueuedStudyDayMaterialJobs(guild);
  }

  async prepareScheduledStudyDayMaterialBatches(guild: Guild) {
    await this.discordStudyPlanService.prepareScheduledStudyDayMaterialBatches(guild);
  }

  async processPendingStudyDayMaterialBatches(guild: Guild) {
    await this.discordStudyPlanService.processPendingStudyDayMaterialBatches(guild);
  }

  async reconcileOrphanStudyPlans(activeDiscordGuildIds: string[]) {
    await this.discordStudyPlanService.reconcileOrphanStudyPlans(activeDiscordGuildIds);
  }

  async markGuildStudyPlansAsOrphaned(discordGuildId: string, reason: string) {
    await this.discordStudyPlanService.markGuildStudyPlansAsOrphaned(discordGuildId, reason);
  }
}
