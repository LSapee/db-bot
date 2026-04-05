import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ChannelType, Client, Events, GatewayIntentBits, Message } from 'discord.js';
import { DiscordDailyChannelService } from './daily/discord-daily-channel.service';
import { DiscordConfigService } from './discord-config.service';
import { DiscordGuildSetupService } from './setup/discord-guild-setup.service';
import { DiscordStudyPlanChannelService } from './study-plan/discord-study-plan-channel.service';
import { DiscordUserThreadService } from './user-thread/discord-user-thread.service';

@Injectable()
export class DiscordService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  private loginPromise?: Promise<string>;

  constructor(
    private readonly discordConfigService: DiscordConfigService,
    private readonly discordDailyChannelService: DiscordDailyChannelService,
    private readonly discordGuildSetupService: DiscordGuildSetupService,
    private readonly discordStudyPlanChannelService: DiscordStudyPlanChannelService,
    private readonly discordUserThreadService: DiscordUserThreadService,
  ) {
    this.client.once(Events.ClientReady, (readyClient) => {
      this.logger.log(`Discord bot connected as ${readyClient.user.tag}`);
      void this.discordGuildSetupService.ensureChannelsForJoinedGuilds(readyClient);
    });
    this.client.on(Events.GuildCreate, (guild) => {
      if (!this.client.isReady()) {
        return;
      }

      void this.discordGuildSetupService.ensureChannelsForGuild(this.client, guild);
    });
    this.client.on(Events.GuildDelete, (guild) => {
      void this.discordDailyChannelService.markGuildStudyPlansAsOrphaned(
        guild.id,
        '봇이 서버에서 제거되었거나 서버가 삭제되었습니다.',
      );
    });
    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessageCreate(message);
    });
  }

  // Logs the bot into Discord when a token is configured.
  // Discord 토큰이 설정되어 있으면 봇 로그인을 수행한다.
  async onModuleInit() {
    const token = this.discordConfigService.token;

    if (!token) {
      this.logger.warn('DISCORD_BOT_TOKEN is not set. Discord login skipped.');
      return;
    }

    if (!this.loginPromise) {
      this.loginPromise = this.client.login(token);
    }

    await this.loginPromise;
  }

  // Closes the Discord connection when the Nest application shuts down.
  // Nest 애플리케이션이 종료될 때 Discord 연결을 정리한다.
  async onApplicationShutdown() {
    if (!this.client.isReady() && !this.loginPromise) {
      return;
    }

    this.client.destroy();
    this.logger.log('Discord client disconnected.');
  }

  // Exposes the underlying Discord client to other services when needed.
  // 다른 서비스가 필요할 때 Discord 클라이언트를 꺼내 쓸 수 있게 한다.
  getClient() {
    return this.client;
  }

  // Routes Discord messages to the appropriate channel-specific handler.
  // Discord 메시지를 채널 성격에 따라 적절한 핸들러로 라우팅한다.
  private async handleMessageCreate(message: Message) {
    if (message.author.bot) {
      return;
    }

    if (message.channel.type === ChannelType.GuildText && message.channel.name === 'db_study_plan') {
      await this.discordStudyPlanChannelService.handleMessage(message);
      return;
    }

    if (
      message.channel.isThread() &&
      message.channel.parent?.type === ChannelType.GuildForum &&
      ['user_answer', 'db_quiz'].includes(message.channel.parent.name)
    ) {
      await this.discordUserThreadService.handleAnswerSubmission(message);
      return;
    }

    if (
      message.channel.isThread() &&
      message.channel.parent?.type === ChannelType.GuildForum &&
      message.channel.parent.name === 'user_ask'
    ) {
      await this.discordUserThreadService.handleQuestion(message);
      return;
    }

    if (
      message.channel.isThread() &&
      message.channel.parent?.type === ChannelType.GuildForum &&
      ['db_tutor', 'db_answer'].includes(message.channel.parent.name)
    ) {
      await this.discordDailyChannelService.handleReadOnlyMessage(message);
    }
  }
}
