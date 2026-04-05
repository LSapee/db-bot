import { Injectable, Logger } from '@nestjs/common';
import {
  CategoryChannel,
  ChannelType,
  Client,
  ForumChannel,
  Guild,
  Message,
  TextChannel,
} from 'discord.js';
import {
  discordDailyCategoryName,
  discordRequiredChannels,
  discordStudyPlanWelcomeMessage,
} from '../discord-channel.constants';

@Injectable()
export class DiscordGuildSetupService {
  private readonly logger = new Logger(DiscordGuildSetupService.name);

  // Ensures every joined guild has the required Discord study channels and ordering.
  // 봇이 참여한 모든 서버에 필요한 학습 채널과 정렬 상태를 보장한다.
  async ensureChannelsForJoinedGuilds(client: Client<true>) {
    for (const guild of client.guilds.cache.values()) {
      await this.ensureChannelsForGuild(client, guild);
    }
  }

  // Ensures one joined guild has the required Discord study channels and onboarding state.
  // 특정 서버 하나에 필요한 학습 채널과 온보딩 상태를 보장한다.
  async ensureChannelsForGuild(client: Client<true>, guild: Guild) {
    await this.ensureRequiredChannelsForGuild(guild);
    await this.ensureChannelOrdering(guild);
    await this.ensureStudyPlanGreeting(client, guild);
  }

  // Creates missing channels and moves existing channels into the expected category.
  // 누락된 채널을 만들고 기존 채널을 올바른 카테고리 아래로 정리한다.
  private async ensureRequiredChannelsForGuild(guild: Guild) {
    await guild.channels.fetch();
    const dailyCategory = await this.ensureDailyCategory(guild);

    for (const requiredChannel of discordRequiredChannels) {
      const existingChannel = guild.channels.cache.find(
        (channel) => channel?.name === requiredChannel.name,
      );

      if (!existingChannel) {
        const createdChannel = await guild.channels.create({
          name: requiredChannel.name,
          type: requiredChannel.type,
          parent: requiredChannel.useDailyCategory ? dailyCategory.id : undefined,
        });
        this.logger.log(
          `Created ${this.describeChannelType(requiredChannel.type)} channel "${requiredChannel.name}" in guild ${guild.name}`,
        );

        if (
          requiredChannel.name === 'db_study_plan' &&
          createdChannel.type === ChannelType.GuildText
        ) {
          await this.sendStudyPlanGreeting(createdChannel as TextChannel);
        }

        continue;
      }

      if (existingChannel.type !== requiredChannel.type) {
        this.logger.warn(
          [
            `Channel "${requiredChannel.name}" in guild ${guild.name} already exists with type ${existingChannel.type}.`,
            `Expected type is ${requiredChannel.type}.`,
          ].join(' '),
        );
        continue;
      }

      await this.ensureChannelParent(
        existingChannel as TextChannel | ForumChannel,
        requiredChannel.useDailyCategory ? dailyCategory : null,
      );
    }
  }

  // Ensures the shared daily category exists before child channels are created.
  // 하위 일일 채널을 만들기 전에 공용 db_daily 카테고리가 존재하도록 한다.
  private async ensureDailyCategory(guild: Guild) {
    const existingCategory = guild.channels.cache.find(
      (channel) => channel?.name === discordDailyCategoryName,
    );

    if (!existingCategory) {
      const createdCategory = await guild.channels.create({
        name: discordDailyCategoryName,
        type: ChannelType.GuildCategory,
      });

      this.logger.log(`Created category "${discordDailyCategoryName}" in guild ${guild.name}`);

      return createdCategory as CategoryChannel;
    }

    if (existingCategory.type !== ChannelType.GuildCategory) {
      throw new Error(
        `Channel "${discordDailyCategoryName}" in guild ${guild.name} exists but is not a category.`,
      );
    }

    return existingCategory as CategoryChannel;
  }

  // Moves a channel under the expected parent category when needed.
  // 필요할 때 채널을 기대하는 상위 카테고리 아래로 이동시킨다.
  private async ensureChannelParent(
    channel: TextChannel | ForumChannel,
    expectedCategory: CategoryChannel | null,
  ) {
    const expectedParentId = expectedCategory?.id ?? null;
    const currentParentId = channel.parentId ?? null;

    if (currentParentId === expectedParentId) {
      return;
    }

    await channel.setParent(expectedParentId, { lockPermissions: false });
    this.logger.log(
      `Moved channel "${channel.name}" under ${expectedCategory?.name ?? 'no category'}`,
    );
  }

  // Ensures the onboarding greeting exists in db_study_plan.
  // db_study_plan 채널에 온보딩 안내 메시지가 존재하도록 보장한다.
  private async ensureStudyPlanGreeting(client: Client<true>, guild: Guild) {
    const studyPlanChannel = this.getStudyPlanChannel(guild);

    if (!studyPlanChannel) {
      this.logger.warn(`Could not find a usable db_study_plan channel in guild ${guild.name}`);
      return;
    }

    const greetingMessage = await this.findStudyPlanGreeting(client, studyPlanChannel);

    if (!greetingMessage) {
      await this.sendStudyPlanGreeting(studyPlanChannel);
      return;
    }

    await this.ensurePinnedStudyPlanGreeting(greetingMessage);
  }

  // Reorders the top-level and daily channels into the expected fixed layout.
  // 최상단 채널과 daily 하위 채널을 기대하는 고정 순서로 재정렬한다.
  private async ensureChannelOrdering(guild: Guild) {
    const studyPlanChannel = guild.channels.cache.find(
      (channel) => channel?.name === 'db_study_plan' && channel.type === ChannelType.GuildText,
    ) as TextChannel | undefined;
    const dailyCategory = guild.channels.cache.find(
      (channel) =>
        channel?.name === discordDailyCategoryName && channel.type === ChannelType.GuildCategory,
    ) as CategoryChannel | undefined;

    if (!studyPlanChannel || !dailyCategory) {
      return;
    }

    const topLevelChannels = [...guild.channels.cache.values()]
      .filter((channel) => !channel.isThread() && channel.parentId === null)
      .sort(
        (leftChannel, rightChannel) =>
          this.getChannelOrderValue(leftChannel) - this.getChannelOrderValue(rightChannel),
      );

    const reorderedTopLevelChannels = [
      studyPlanChannel,
      dailyCategory,
      ...topLevelChannels.filter(
        (channel) => channel.id !== studyPlanChannel.id && channel.id !== dailyCategory.id,
      ),
    ];

    await guild.channels.setPositions(
      reorderedTopLevelChannels.map((channel, index) => ({
        channel: channel.id,
        position: index,
      })),
    );
    const orderedDailyChannels = [
      'db_tutor',
      'db_quiz',
      'db_answer',
      'user_ask',
    ];

    const currentDailyChannels = [...guild.channels.cache.values()]
      .filter((channel) => !channel.isThread() && channel.parentId === dailyCategory.id)
      .sort(
        (leftChannel, rightChannel) =>
          this.getChannelOrderValue(leftChannel) - this.getChannelOrderValue(rightChannel),
      );

    const prioritizedDailyChannels = orderedDailyChannels
      .map((channelName) =>
        currentDailyChannels.find((channel) => channel.name === channelName),
      )
      .filter((channel): channel is TextChannel | ForumChannel => Boolean(channel));

    const reorderedDailyChannels = [
      ...prioritizedDailyChannels,
      ...currentDailyChannels.filter(
        (channel) => !orderedDailyChannels.includes(channel.name),
      ),
    ];

    await guild.channels.setPositions(
      reorderedDailyChannels.map((channel, index) => ({
        channel: channel.id,
        position: index,
      })),
    );
  }

  // Sends the initial onboarding prompt to the shared study plan channel.
  // 공용 학습 계획 채널에 초기 안내 메시지를 보낸다.
  private async sendStudyPlanGreeting(studyPlanChannel: TextChannel) {
    const greetingMessage = await studyPlanChannel.send(discordStudyPlanWelcomeMessage);
    await this.ensurePinnedStudyPlanGreeting(greetingMessage);
  }

  // Finds the onboarding prompt in channel history when it already exists.
  // 채널 이력에서 기존 초기 안내 메시지를 찾아 반환한다.
  private async findStudyPlanGreeting(client: Client<true>, studyPlanChannel: TextChannel) {
    let beforeMessageId: string | undefined;

    while (true) {
      const messages = await studyPlanChannel.messages.fetch({
        limit: 100,
        before: beforeMessageId,
      });

      if (messages.size === 0) {
        return null;
      }

      const greetingMessage =
        messages.find(
        (message) =>
          message.author.id === client.user.id && message.content === discordStudyPlanWelcomeMessage,
        ) ?? null;

      if (greetingMessage) {
        return greetingMessage;
      }

      beforeMessageId = messages.last()?.id;

      if (!beforeMessageId) {
        return null;
      }
    }
  }

  // Pins the onboarding prompt when it is not pinned yet, but does not fail setup on permission errors.
  // 권한 문제 등으로 실패하더라도 서버 초기 설정 전체는 깨지지 않게 초기 안내 메시지 고정을 시도한다.
  private async ensurePinnedStudyPlanGreeting(greetingMessage: Message) {
    if (greetingMessage.pinned) {
      return;
    }

    try {
      await greetingMessage.pin();
    } catch (error) {
      this.logger.warn(
        `Failed to pin db_study_plan greeting message ${greetingMessage.id}: ${String(error)}`,
      );
    }
  }

  // Returns the db_study_plan text channel when it exists and has the expected type.
  // db_study_plan 채널이 존재하고 일반 텍스트 채널이면 반환한다.
  private getStudyPlanChannel(guild: Guild) {
    const studyPlanChannel = guild.channels.cache.find(
      (channel) => channel?.name === 'db_study_plan',
    );

    if (!studyPlanChannel || studyPlanChannel.type !== ChannelType.GuildText) {
      return null;
    }

    return studyPlanChannel as TextChannel;
  }

  // Converts Discord channel type values into readable log labels.
  // Discord 채널 타입 값을 사람이 읽기 쉬운 로그 문자열로 바꾼다.
  private describeChannelType(type: ChannelType) {
    if (type === ChannelType.GuildText) {
      return 'text';
    }

    if (type === ChannelType.GuildForum) {
      return 'forum';
    }

    return String(type);
  }

  // Returns a stable order value from a non-thread guild channel.
  // 스레드가 아닌 서버 채널에서 정렬용 위치 값을 안전하게 반환한다.
  private getChannelOrderValue(channel: unknown) {
    if (
      typeof channel === 'object' &&
      channel !== null &&
      'rawPosition' in channel &&
      typeof channel.rawPosition === 'number'
    ) {
      return channel.rawPosition;
    }

    return 0;
  }
}
