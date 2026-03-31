import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscordDailyChannelService } from '../daily/discord-daily-channel.service';
import { DiscordService } from '../discord.service';

@Injectable()
export class DiscordSchedulerService {
  private readonly logger = new Logger(DiscordSchedulerService.name);

  constructor(
    private readonly discordService: DiscordService,
    private readonly discordDailyChannelService: DiscordDailyChannelService,
  ) {}

  // Starts daily Batch preparation shortly before the 10:00 publish window.
  // 매일 오전 9시 55분에 이후 일차 자료용 Batch 준비를 시작한다.
  @Cron('55 9 * * *', {
    timeZone: 'Asia/Seoul',
  })
  private async prepareScheduledStudyDayMaterialBatches() {
    const discordClient = this.discordService.getClient();

    if (!discordClient.isReady()) {
      return;
    }

    await this.discordDailyChannelService.reconcileOrphanStudyPlans([
      ...discordClient.guilds.cache.keys(),
    ]);

    for (const guild of discordClient.guilds.cache.values()) {
      try {
        await this.discordDailyChannelService.prepareScheduledStudyDayMaterialBatches(guild);
      } catch (error) {
        this.logger.error(
          `Failed to prepare scheduled study day material batches for guild ${guild.id}`,
          error,
        );
      }
    }
  }

  // Runs the daily publish-and-generate scheduler at 10:00 AM Asia/Seoul.
  // 매일 오전 10시 기준으로 게시와 다음 버퍼 생성 작업을 실행한다.
  @Cron('0 10 * * *', {
    timeZone: 'Asia/Seoul',
  })
  private async processScheduledStudyProgression() {
    const discordClient = this.discordService.getClient();

    if (!discordClient.isReady()) {
      return;
    }

    await this.discordDailyChannelService.reconcileOrphanStudyPlans([
      ...discordClient.guilds.cache.keys(),
    ]);

    for (const guild of discordClient.guilds.cache.values()) {
      try {
        await this.discordDailyChannelService.processAutomatedStudyPlans(guild);
      } catch (error) {
        this.logger.error(`Failed to process scheduled study plans for guild ${guild.id}`, error);
      }
    }
  }

  // Polls pending batch jobs and remaining realtime material jobs every 10 minutes.
  // 30분마다 진행 중인 Batch와 남아 있는 realtime 생성 작업을 처리한다.
  @Cron('*/30 * * * *', {
    timeZone: 'Asia/Seoul',
  })
  private async processQueuedStudyDayMaterials() {
    const discordClient = this.discordService.getClient();

    if (!discordClient.isReady()) {
      return;
    }

    await this.discordDailyChannelService.reconcileOrphanStudyPlans([
      ...discordClient.guilds.cache.keys(),
    ]);

    for (const guild of discordClient.guilds.cache.values()) {
      try {
        await this.discordDailyChannelService.processPendingStudyDayMaterialBatches(guild);
        await this.discordDailyChannelService.processQueuedStudyDayMaterialJobs(guild);
      } catch (error) {
        this.logger.error(
          `Failed to process queued study day material jobs for guild ${guild.id}`,
          error,
        );
      }
    }
  }

  // Runs a lightweight completion reconciliation scheduler so finished plans can close on time.
  // 완료 시점을 맞추기 위해 가벼운 완료 보정 스케줄러를 주기적으로 실행한다.
  @Cron('*/5 * * * *', {
    timeZone: 'Asia/Seoul',
  })
  private async processStudyPlanCompletionReconciliation() {
    const discordClient = this.discordService.getClient();

    if (!discordClient.isReady()) {
      return;
    }

    await this.discordDailyChannelService.reconcileOrphanStudyPlans([
      ...discordClient.guilds.cache.keys(),
    ]);

    for (const guild of discordClient.guilds.cache.values()) {
      try {
        await this.discordDailyChannelService.processAutomatedStudyPlans(guild);
      } catch (error) {
        this.logger.error(
          `Failed to reconcile study plan completion for guild ${guild.id}`,
          error,
        );
      }
    }
  }
}
