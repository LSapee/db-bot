import { Global, Module } from '@nestjs/common';
import { DiscordConfigService } from './discord-config.service';
import { DiscordDailyChannelService } from './daily/discord-daily-channel.service';
import { DiscordGuildSetupService } from './setup/discord-guild-setup.service';
import { DiscordSchedulerService } from './scheduler/discord-scheduler.service';
import { DiscordService } from './discord.service';
import { DiscordStudyPlanChannelService } from './study-plan/discord-study-plan-channel.service';
import { DiscordStudyPlanService } from './study-plan/discord-study-plan.service';
import { DiscordUserThreadService } from './user-thread/discord-user-thread.service';

@Global()
@Module({
  providers: [
    DiscordConfigService,
    DiscordGuildSetupService,
    DiscordSchedulerService,
    DiscordStudyPlanChannelService,
    DiscordDailyChannelService,
    DiscordUserThreadService,
    DiscordService,
    DiscordStudyPlanService,
  ],
  exports: [DiscordService],
})
export class DiscordModule {}
