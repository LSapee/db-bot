import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, ForumChannel, Guild, Message, TextChannel } from 'discord.js';
import {
  discordArchiveStudyPlanInvalidSelectionMessage,
  discordActiveStudyPlanListActionGuideMessage,
  discordCancelledStudyPlanListActionGuideMessage,
  createDiscordCourseConfirmationPromptMessage,
  createDiscordCourseSelectionPromptMessage,
  createDiscordDetailedPlanLoadingMessage,
  createDiscordExistingStudyPlanInvalidSelectionMessage,
  createDiscordExistingStudyPlanPromptMessage,
  createDiscordSelectedCourseMessage,
  createDiscordStudyCoursePreviewLoadingMessage,
  createDiscordStudyStartLoadingMessage,
  discordActiveStudyPlanLimitMessage,
  discordCancelledStudyPlanLimitMessage,
  discordFixedCourseSelectionSummaryText,
  discordInvalidCourseConfirmationMessage,
  discordStudyPlanHelpMessage,
  discordStudyPlanAlreadyStartingMessage,
  discordStudyPlanStartPromptMessage,
  discordInvalidCourseSelectionMessage,
  discordResumeStudyPlanInvalidSelectionMessage,
  discordStopStudyPlanNotActiveMessage,
  discordStopStudyPlanInvalidSelectionMessage,
  discordStudyPlanInvalidDurationMessage,
  discordStudyPlanCancelledMessage,
  discordStudyPlanNewPlanPromptMessage,
  discordUnsupportedStudyPlanCommandMessage,
  discordStudyPlanWelcomeMessage,
} from '../discord-channel.constants';
import {
  GeneratedStudyDayMaterials,
  GeneratedStudyQuestionAnswer,
  GeneratedStudyPlan,
  GeneratedStudyPlanDay,
  OpenAiService,
} from '../../openai/openai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourseConfirmationState,
  CourseSelectionState,
  ExistingPlanDecisionState,
  PlanCreationMode,
  StartSelectionState,
  StudyCourseName,
  StudyPlanListOverlayState,
  StudyPlanConversationState,
} from './discord-study-plan.types';
import {
  buildGeneratedStudyDayMaterialsFromStoredDay,
  createEmptyStudyPlanListMessage,
  createStudyDayThreadName,
  createUserAnswerThreadName,
  createUserAskThreadName,
  formatAnswerThreadMessage,
  formatGeneratedStudyPlanMessage,
  formatIndexedStudyPlanSummary,
  formatQuizThreadMessage,
  formatStartedDate,
  formatTutorThreadMessage,
  formatUserAnswerThreadMessage,
  formatUserAskThreadMessage,
  getFirstStudyDay,
  getStudyPlanListTitle,
} from './discord-study-plan.formatters';
import {
  parseArchivePlanSelection,
  parseCourseSelection,
  parseDurationDays,
  parseResumePlanSelection,
  parseStoredGeneratedStudyPlan,
  parseStoredStudyCourseName,
  parseStopPlanSelection,
  parseStudyQuestionCommand,
  parseSubmissionCommand,
  parseUserAnswerThreadContext,
  parseUserAskThreadContext,
} from './discord-study-plan.parsers';

class MissingDiscordChannelError extends Error {
  constructor(
    readonly channelName: string,
    readonly channelType: 'text' | 'forum',
  ) {
    super(`Required ${channelType} channel "${channelName}" was not found.`);
    this.name = 'MissingDiscordChannelError';
  }
}

@Injectable()
export class DiscordStudyPlanService {
  private readonly logger = new Logger(DiscordStudyPlanService.name);
  private readonly automatedCompletionDelayMs = 15 * 60 * 1000;
  private readonly automatedPublishHour = 10;
  private readonly automatedPublishMinute = 0;
  private readonly studyCoursePreviewTemplatePromptVersion = 1;
  private readonly studyPlanTemplatePromptVersion = 1;
  private readonly studyDayMaterialJobConcurrency = 3;
  private readonly preGeneratedDayCount = 3;
  private readonly courseSelectionStates = new Map<string, StudyPlanConversationState>();
  private readonly studyPlanListOverlayStates = new Map<string, StudyPlanListOverlayState>();
  private readonly automationLocks = new Set<string>();
  private readonly startLocks = new Set<string>();
  private readonly pendingPlanCreationModes = new Map<
    string,
    {
      creationMode: PlanCreationMode;
      activePlanIdsToCancel: string[];
    }
  >();

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly prismaService: PrismaService,
  ) {}

  private createNextScheduledPublishAt(baseTime = new Date()) {
    const nextPublishAt = new Date(baseTime);
    nextPublishAt.setSeconds(0, 0);
    nextPublishAt.setHours(this.automatedPublishHour, this.automatedPublishMinute, 0, 0);

    if (nextPublishAt.getTime() <= baseTime.getTime()) {
      nextPublishAt.setDate(nextPublishAt.getDate() + 1);
    }

    return nextPublishAt;
  }

  async reconcileOrphanStudyPlans(activeDiscordGuildIds: string[]) {
    if (activeDiscordGuildIds.length === 0) {
      this.logger.warn('Skipped orphan study plan reconciliation because no active guild ids were provided.');
      return;
    }

    const orphanGuilds = await this.prismaService.discord_guilds.findMany({
      where: {
        discord_guild_id: {
          notIn: activeDiscordGuildIds,
        },
        study_plans: {
          some: {
            status: {
              in: ['DRAFT', 'READY', 'ACTIVE'],
            },
          },
        },
      },
      select: {
        id: true,
        discord_guild_id: true,
      },
    });

    for (const orphanGuild of orphanGuilds) {
      await this.markGuildStudyPlansAsOrphaned(
        orphanGuild.discord_guild_id,
        'Discord client cache에서 서버를 찾을 수 없습니다.',
      );
    }
  }

  async markGuildStudyPlansAsOrphaned(discordGuildId: string, reason: string) {
    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: discordGuildId,
      },
      select: {
        id: true,
      },
    });

    if (!guildRecord) {
      return;
    }

    const updatedPlans = await this.prismaService.study_plans.updateMany({
      where: {
        guild_uuid: guildRecord.id,
        status: {
          in: ['DRAFT', 'READY', 'ACTIVE'],
        },
      },
      data: {
        status: 'CANCELLED',
        next_publish_at: null,
      },
    });

    this.pendingPlanCreationModes.delete(discordGuildId);
    this.courseSelectionStates.delete(discordGuildId);
    this.studyPlanListOverlayStates.delete(discordGuildId);
    this.startLocks.delete(discordGuildId);

    if (updatedPlans.count > 0) {
      this.logger.warn(
        `Marked ${updatedPlans.count} study plans as orphaned for guild ${discordGuildId}. Reason: ${reason}`,
      );
    }
  }

  private async tryAcquirePlanAutomationLock(studyPlanId: string) {
    const lockRows = await this.prismaService.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext('study_plan_automation'), hashtext(${studyPlanId})) AS locked
    `;

    return lockRows[0]?.locked === true;
  }

  private async releasePlanAutomationLock(studyPlanId: string) {
    await this.prismaService.$queryRaw`
      SELECT pg_advisory_unlock(hashtext('study_plan_automation'), hashtext(${studyPlanId}))
    `;
  }

  // Handles the study duration conversation in the shared study plan channel.
  // 공용 학습 계획 채널에서 학습 기간 대화를 상태 기반으로 처리한다.
  async handleDurationReply(message: Message) {
    if (!this.isGuildOwnerMessage(message)) {
      await this.deleteControlMessage(message);
      return;
    }

    const rawContent = message.content.trim();
    const rawTrimmedContent = message.content.trim();
    const normalizedContent = message.content.trim().toUpperCase();
    const durationDays = parseDurationDays(normalizedContent);
    const selectedCourseName = parseCourseSelection(rawContent);
    const guildId = message.guildId;
    const currentConversationState = guildId
      ? this.courseSelectionStates.get(guildId) ?? null
      : null;

    if (guildId) {
      const studyPlanListOverlayState = this.studyPlanListOverlayStates.get(guildId);

      if (studyPlanListOverlayState) {
        await this.handleStudyPlanListOverlay(message, rawContent, studyPlanListOverlayState);
        return;
      }
    }

    if (await this.handleStudyPlanCommand(message, rawContent, currentConversationState)) {
      return;
    }

    if (guildId) {
      const courseSelectionState = this.courseSelectionStates.get(guildId);

      if (courseSelectionState) {
        if (courseSelectionState.stage === 'AWAITING_DURATION_INPUT') {
          if (durationDays !== null) {
            await this.handleDurationEntry(message, durationDays);
            return;
          }

          if (rawTrimmedContent === '취소') {
            this.pendingPlanCreationModes.delete(guildId);
            this.courseSelectionStates.delete(guildId);
            await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
            return;
          }

          await this.sendChannelMessage(message, discordUnsupportedStudyPlanCommandMessage);
          await this.sendCurrentStudyPlanContext(message, courseSelectionState);
          return;
        }

        if (courseSelectionState.stage === 'AWAITING_EXISTING_PLAN_DECISION') {
          await this.handleExistingPlanDecision(message, courseSelectionState, rawContent);
          return;
        }

        if (courseSelectionState.stage === 'AWAITING_COURSE_SELECTION') {
          await this.handleCourseSelection(message, courseSelectionState, selectedCourseName);
          return;
        }

        if (courseSelectionState.stage === 'AWAITING_COURSE_CONFIRMATION') {
          await this.handleCourseConfirmation(message, courseSelectionState, selectedCourseName);
          return;
        }

        if (courseSelectionState.stage === 'AWAITING_START') {
          await this.handleStudyStart(message, courseSelectionState);
          return;
        }
      }
    }

    if (rawTrimmedContent === '취소') {
      if (guildId) {
        this.pendingPlanCreationModes.delete(guildId);
        this.courseSelectionStates.delete(guildId);
      }
      await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
      return;
    }

    if (durationDays !== null) {
      await this.handleDurationEntry(message, durationDays);
      return;
    }

    if (rawTrimmedContent === '새 학습') {
      if (guildId) {
        this.pendingPlanCreationModes.delete(guildId);
        this.courseSelectionStates.set(guildId, {
          stage: 'AWAITING_DURATION_INPUT',
        });
      }
      await this.sendChannelMessage(message, discordStudyPlanNewPlanPromptMessage);
      return;
    }

    await this.sendChannelMessage(message, discordUnsupportedStudyPlanCommandMessage);
    await this.sendCurrentStudyPlanContext(message, null);
  }

  // Sends a message only when the current Discord channel supports outgoing messages.
  // 현재 Discord 채널이 메시지 전송을 지원할 때만 응답을 보낸다.
  private async sendChannelMessage(message: Message, content: string) {
    if (!message.channel.isSendable()) {
      return;
    }

    for (const contentChunk of this.splitDiscordMessageContent(content)) {
      await message.channel.send(contentChunk);
    }
  }

  // Builds a user-facing study-plan error message with a short normalized cause.
  // 학습 계획 단계에서 사용자에게 보여줄 에러 문구를 짧은 원인과 함께 구성한다.
  private createStudyPlanErrorMessage(title: string, error: unknown) {
    const errorReason = this.getReadableStudyPlanErrorReason(error);

    return `${title} 원인: ${errorReason}`;
  }

  // Returns whether the current start-flow error should ask the user to retry with "start" later.
  // 학습 시작 중 학습 자료 생성 실패라면 잠시 후 다시 "시작"을 안내할지 판단한다.
  private shouldSuggestRetryStudyStart(error: unknown) {
    const rawReason =
      error instanceof Error ? error.message : String(error ?? '알 수 없는 오류');

    return (
      rawReason.includes('학습 자료 생성에 실패했습니다.') ||
      rawReason.includes('LLM JSON 파싱 실패')
    );
  }

  // Normalizes an unknown error into a short readable reason for Discord messages.
  // Discord 메시지에 넣기 좋게 알 수 없는 에러 값을 짧은 원인 문자열로 정리한다.
  private getReadableStudyPlanErrorReason(error: unknown) {
    const rawReason =
      error instanceof Error ? error.message : String(error ?? '알 수 없는 오류');
    const singleLineReason = rawReason.replace(/\s+/g, ' ').trim();

    if (!singleLineReason) {
      return '알 수 없는 오류가 발생했습니다.';
    }

    if (singleLineReason.length <= 180) {
      return singleLineReason;
    }

    return `${singleLineReason.slice(0, 177)}...`;
  }

  // Replays the current study-plan context so users can recover after an invalid input.
  // 입력 오류 뒤에 현재 학습 계획 단계의 안내를 다시 보여준다.
  private async sendCurrentStudyPlanContext(
    message: Message,
    conversationState: StudyPlanConversationState | null,
  ) {
    if (conversationState?.stage === 'AWAITING_DURATION_INPUT') {
      await this.sendChannelMessage(message, discordStudyPlanNewPlanPromptMessage);
      return;
    }

    if (conversationState?.stage === 'AWAITING_EXISTING_PLAN_DECISION') {
      await this.sendChannelMessage(
        message,
        createDiscordExistingStudyPlanPromptMessage(
          conversationState.activePlans.map((studyPlan) => studyPlan.summaryLine),
        ),
      );
      return;
    }

    if (conversationState?.stage === 'AWAITING_COURSE_SELECTION') {
      await this.sendChannelMessage(
        message,
        createDiscordCourseSelectionPromptMessage(
          conversationState.totalDays,
          conversationState.courseSelectionSummaryText,
        ),
      );
      return;
    }

    if (conversationState?.stage === 'AWAITING_COURSE_CONFIRMATION') {
      await this.sendChannelMessage(
        message,
        createDiscordSelectedCourseMessage(
          conversationState.selectedCourseName,
          conversationState.selectedCourseContent,
        ),
      );
      return;
    }

    if (conversationState?.stage === 'AWAITING_START') {
      await this.sendChannelMessage(message, discordStudyPlanStartPromptMessage);
      return;
    }

    await this.sendChannelMessage(message, discordStudyPlanWelcomeMessage);
  }

  // Handles one temporary list overlay interaction and then returns to the previous step.
  // 임시 리스트 오버레이 입력을 한 번 처리한 뒤 이전 단계로 복귀시킨다.
  private async handleStudyPlanListOverlay(
    message: Message,
    rawContent: string,
    studyPlanListOverlayState: StudyPlanListOverlayState,
  ) {
    this.studyPlanListOverlayStates.delete(message.guildId ?? '');

    if (studyPlanListOverlayState.listType === 'ACTIVE') {
      const selectedStopPlanNumber = parseStopPlanSelection(rawContent);

      if (selectedStopPlanNumber !== null) {
        await this.stopActiveStudyPlan(message, selectedStopPlanNumber);
        await this.restoreStudyPlanContextAfterOverlay(
          message,
          studyPlanListOverlayState.previousState,
        );
        return;
      }
    }

    if (studyPlanListOverlayState.listType === 'CANCELLED') {
      const selectedResumePlanNumber = parseResumePlanSelection(rawContent);

      if (selectedResumePlanNumber !== null) {
        await this.resumeCancelledStudyPlan(message, selectedResumePlanNumber);
        await this.restoreStudyPlanContextAfterOverlay(
          message,
          studyPlanListOverlayState.previousState,
        );
        return;
      }

      const selectedArchivePlanNumber = parseArchivePlanSelection(rawContent);

      if (selectedArchivePlanNumber !== null) {
        await this.archiveCancelledStudyPlan(message, selectedArchivePlanNumber);
        await this.restoreStudyPlanContextAfterOverlay(
          message,
          studyPlanListOverlayState.previousState,
        );
        return;
      }
    }

    await this.restoreStudyPlanContextAfterOverlay(message, studyPlanListOverlayState.previousState);
  }

  // Stores a temporary list overlay so the user can return to the previous step afterwards.
  // 리스트 화면 이후 다시 이전 단계로 돌아갈 수 있도록 임시 오버레이 상태를 저장한다.
  private pushStudyPlanListOverlay(
    guildId: string | null,
    listType: 'ACTIVE' | 'CANCELLED' | 'COMPLETED',
    previousState: StudyPlanConversationState | null,
  ) {
    if (!guildId) {
      return;
    }

    this.studyPlanListOverlayStates.set(guildId, {
      listType,
      previousState,
    });
  }

  // Restores the step that was active before the temporary list overlay was opened.
  // 임시 리스트 오버레이를 열기 전의 학습 계획 단계를 복원한다.
  private async restoreStudyPlanContextAfterOverlay(
    message: Message,
    previousState: StudyPlanConversationState | null,
  ) {
    if (previousState) {
      await this.sendCurrentStudyPlanContext(message, previousState);
      return;
    }

    await this.sendChannelMessage(message, discordStudyPlanWelcomeMessage);
  }

  // Handles user quiz submissions posted inside a user_answer forum thread.
  // user_answer 포럼 스레드 안에 올라온 사용자 제출 메시지를 처리한다.
  async handleUserAnswerSubmission(message: Message) {
    if (!message.channel.isThread()) {
      return;
    }

    const parsedSubmission = parseSubmissionCommand(message.content);

    if (!parsedSubmission) {
      const invalidSubmissionNotice = await message.reply(
        [
          '제출 형식이 올바르지 않습니다.',
          '문제 번호 아래에 답안을 코드블록으로 작성해서 다시 제출해주세요.',
          '!제출 문제 1',
          '```sql',
          'SELECT *',
          'FROM example_table;',
          '```',
        ].join('\n'),
      );
      this.scheduleMessageDeletion(message, 5 * 60 * 1000);
      this.scheduleMessageDeletion(invalidSubmissionNotice, 5 * 60 * 1000);
      return;
    }

    const directSubmissionContext = await this.findSubmissionThreadContextByChannelId(
      message,
      parsedSubmission.questionNo,
    );
    const submissionThreadContext = directSubmissionContext
      ? null
      : parseUserAnswerThreadContext(message.channel.name);
    const targetStudyPlan = directSubmissionContext
      ? directSubmissionContext.studyPlan
      : await this.findStudyPlanByThreadContext(message, submissionThreadContext);

    if (!targetStudyPlan) {
      await message.reply('현재 스레드의 제출 정보를 확인할 수 없습니다.');
      return;
    }

    if (targetStudyPlan.status !== 'ACTIVE') {
      await this.sendInactivePlanNotice(message, targetStudyPlan.status, 5 * 60 * 1000);
      return;
    }

    const targetQuizItem =
      directSubmissionContext?.quizItem ??
      (await this.findQuizItemForSubmission(message, submissionThreadContext, parsedSubmission.questionNo));

    if (!targetQuizItem) {
      await message.reply(
        '해당 문제를 찾을 수 없습니다. `!제출 문제 1` 형식으로 다시 확인해주세요.',
      );
      return;
    }

    const guildRecord = await this.ensureDiscordGuild(message);
    const memberRecord = await this.ensureDiscordMember(message, guildRecord.id);
    const submissionCount = await this.prismaService.submissions.count({
      where: {
        quiz_item_uuid: targetQuizItem.id,
        member_uuid: memberRecord.id,
      },
    });

    if (submissionCount >= 3) {
      await message.reply(`해당 문제는 이미 3회 제출하셨습니다. 더 이상 제출할 수 없습니다.`);
      return;
    }

    const createdSubmission = await this.prismaService.submissions.create({
      data: {
        quiz_item_uuid: targetQuizItem.id,
        member_uuid: memberRecord.id,
        discord_message_id: message.id,
        answer_text: parsedSubmission.answerText,
      },
    });

    const reviewMessage = await this.openAiService.reviewQuizSubmission(
      targetQuizItem.question_no,
      targetQuizItem.prompt_text,
      targetQuizItem.model_answer_text,
      targetQuizItem.explanation_text,
      parsedSubmission.answerText,
    );

    await message.author.send(
      [
        `[${directSubmissionContext?.dayNumber ?? submissionThreadContext?.dayNumber ?? '?'}일차 문제 ${targetQuizItem.question_no} 제출 결과]`,
        '제출 내용',
        this.formatDiscordCodeBlock(
          parsedSubmission.answerText,
          parsedSubmission.codeBlockLanguage,
        ),
        reviewMessage,
      ].join('\n\n'),
    );

    const submissionNotice = await message.reply(
      `${targetQuizItem.question_no}번 문제 제출을 확인하였습니다. 1분 뒤에 메시지가 지워집니다.`,
    );
    this.scheduleMessageDeletion(message, 2 * 60 * 1000);
    this.scheduleMessageDeletion(submissionNotice, 2 * 60 * 1000);

    await this.prismaService.submissions.update({
      where: {
        id: createdSubmission.id,
      },
      data: {
        status: 'RESPONDED',
      },
    });
  }

  // Rejects messages posted inside read-only tutor/quiz/hint threads and cleans them up later.
  // 읽기 전용 tutor/quiz/hint 스레드에 올라온 메시지를 안내 후 정리한다.
  async handleReadOnlyDailyThreadMessage(message: Message) {
    const readOnlyNotice = await message.reply(
      '해당 스레드는 읽기만 가능합니다. 이 안내 메시지와 작성하신 메시지는 1분 뒤에 삭제됩니다.',
    );
    this.scheduleMessageDeletion(message,  60 * 1000);
    this.scheduleMessageDeletion(readOnlyNotice,  60 * 1000);
  }

  // Processes timed study automation for all active study plans in one guild.
  // 하나의 서버에 속한 ACTIVE 학습 계획들에 대해 시간 기반 자동 진행을 처리한다.
  async processAutomatedStudyPlans(guild: Guild) {
    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: guild.id,
      },
    });

    if (!guildRecord) {
      return;
    }

    const activeStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'ACTIVE',
      },
      include: {
        study_days: {
          orderBy: {
            day_number: 'asc',
          },
          include: {
            day_contents: true,
            quizzes: {
              include: {
                quiz_items: {
                  include: {
                    quiz_hints: true,
                  },
                  orderBy: {
                    question_no: 'asc',
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    for (const activeStudyPlan of activeStudyPlans) {
      if (this.automationLocks.has(activeStudyPlan.id)) {
        continue;
      }

      const hasAcquiredAutomationLock = await this.tryAcquirePlanAutomationLock(activeStudyPlan.id);

      if (!hasAcquiredAutomationLock) {
        continue;
      }

      this.automationLocks.add(activeStudyPlan.id);

      try {
        await this.processAutomatedStudyPlan(guild, activeStudyPlan);
      } catch (error) {
        this.logger.error(`Failed to process automated plan ${activeStudyPlan.id}`, error);
      } finally {
        this.automationLocks.delete(activeStudyPlan.id);
        await this.releasePlanAutomationLock(activeStudyPlan.id);
      }
    }
  }

  // Processes pre-generation, timed publishing, and completion for a single active study plan.
  // 하나의 ACTIVE 학습 계획에 대해 선생성, 시간 기반 게시, 완료 처리를 진행한다.
  private async processAutomatedStudyPlan(
    guild: Guild,
    activeStudyPlan: {
      id: string;
      goal_text: string;
      requested_range_text: string | null;
      total_days: number;
      current_day: number;
      created_at: Date;
      next_publish_at: Date | null;
      start_date: Date | null;
      plan_raw: unknown;
      status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
      study_days: Array<{
        id: string;
        day_number: number;
        title: string;
        topic_summary: string;
        learning_goal: string;
        scope_text: string | null;
        status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
        scheduled_date: Date | null;
        day_contents: {
          id: string;
          summary_text: string | null;
          content_text: string;
          discord_message_id: string | null;
          published_at: Date | null;
        } | null;
        quizzes: {
          id: string;
          intro_text: string | null;
          discord_message_id: string | null;
          published_at: Date | null;
          quiz_items: Array<{
            id: string;
            question_no: number;
            prompt_text: string;
            expected_points: unknown;
            model_answer_text: string;
            explanation_text: string;
            quiz_hints: Array<{
              id: string;
              hint_no: number;
              hint_text: string;
            }>;
          }>;
        } | null;
      }>;
    },
  ) {
    const selectedCourseName = parseStoredStudyCourseName(activeStudyPlan.requested_range_text);

    if (!selectedCourseName) {
      return;
    }

    const generatedStudyPlan = parseStoredGeneratedStudyPlan(activeStudyPlan.plan_raw);

    if (!generatedStudyPlan) {
      return;
    }

    const nextStudyDayNumber = activeStudyPlan.current_day + 1;

    if (nextStudyDayNumber <= activeStudyPlan.total_days) {
      const nextPublishAt = activeStudyPlan.next_publish_at;

      if (nextPublishAt && Date.now() >= nextPublishAt.getTime()) {
        const hasPublishedNextStudyDay = await this.publishNextStudyDayIfReady(
          guild,
          activeStudyPlan,
          selectedCourseName,
          generatedStudyPlan,
          nextStudyDayNumber,
        );

        if (hasPublishedNextStudyDay) {
          await this.completeStudyPlanIfLastDayElapsed(activeStudyPlan.id);
        }
      }
    }

    await this.completeStudyPlanIfLastDayElapsed(activeStudyPlan.id);
  }

  // Pre-generates upcoming study day materials so two future days stay buffered in the database.
  // 앞으로 사용할 2일치 정도의 학습 자료가 DB에 미리 준비되도록 선생성한다.
  private async ensureBufferedStudyDayMaterials(
    activeStudyPlan: {
      id: string;
      goal_text: string;
      requested_range_text: string | null;
      total_days: number;
      current_day: number;
      plan_raw: unknown;
      study_days: Array<{
        id: string;
        day_number: number;
        title: string;
        topic_summary: string;
        learning_goal: string;
        scope_text: string | null;
        day_contents: {
          id: string;
        } | null;
        quizzes: {
          id: string;
        } | null;
      }>;
    },
    selectedCourseName: StudyCourseName,
    generatedStudyPlan: GeneratedStudyPlan,
    currentDayNumber: number,
    guild?: Guild,
  ) {
    const targetBufferedDayNumber = Math.min(
      activeStudyPlan.total_days,
      currentDayNumber + 2,
    );

    for (
      let targetDayNumber = currentDayNumber + 1;
      targetDayNumber <= targetBufferedDayNumber;
      targetDayNumber += 1
    ) {
      const targetStudyDay = activeStudyPlan.study_days.find(
        (studyDay) => studyDay.day_number === targetDayNumber,
      );

      if (!targetStudyDay) {
        continue;
      }

      if (targetStudyDay.day_contents && targetStudyDay.quizzes) {
        continue;
      }

      const generatedStudyDay = generatedStudyPlan.days.find(
        (studyDay) => studyDay.dayNumber === targetDayNumber,
      );

      if (!generatedStudyDay) {
        continue;
      }
    }

    await this.enqueueStudyDayMaterialGenerationJobs(
      activeStudyPlan.id,
      activeStudyPlan.study_days
        .filter((studyDay) => {
          if (studyDay.day_number <= currentDayNumber) {
            return false;
          }

          if (studyDay.day_number > targetBufferedDayNumber) {
            return false;
          }

          return !(studyDay.day_contents && studyDay.quizzes);
        })
        .map((studyDay) => studyDay.id),
    );

    await this.processQueuedStudyDayMaterialJobsForPlan(activeStudyPlan.id, guild);
  }

  // Pre-generates the requested range of upcoming study days right after the plan starts.
  // 학습 시작 직후 지정한 범위의 다음 일차들을 미리 생성해 DB에 저장한다.
  private async preGenerateUpcomingStudyDays(
    persistedStudyPlan: {
      studyPlanId: string;
      studyDayIdByNumber: Record<number, string>;
    },
    startSelectionState: StartSelectionState,
    startDayNumber: number,
    endDayNumber: number,
    guild?: Guild,
  ) {
    const targetStudyDayIds = [] as string[];

    for (
      let targetDayNumber = startDayNumber;
      targetDayNumber <= endDayNumber;
      targetDayNumber += 1
    ) {
      const generatedStudyDay = startSelectionState.generatedStudyPlan.days.find(
        (studyDay) => studyDay.dayNumber === targetDayNumber,
      );
      const targetStudyDayUuid = persistedStudyPlan.studyDayIdByNumber[targetDayNumber];

      if (!generatedStudyDay || !targetStudyDayUuid) {
        continue;
      }

      targetStudyDayIds.push(targetStudyDayUuid);
    }

    await this.enqueueStudyDayMaterialGenerationJobs(
      persistedStudyPlan.studyPlanId,
      targetStudyDayIds,
    );
    await this.processQueuedStudyDayMaterialJobsForPlan(persistedStudyPlan.studyPlanId, guild);
  }

  async prepareScheduledStudyDayMaterialBatches(guild: Guild) {
    if (!this.openAiService.isConfigured()) {
      return;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: guild.id,
      },
    });

    if (!guildRecord) {
      return;
    }

    const activeStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'ACTIVE',
      },
      include: {
        study_days: {
          include: {
            day_contents: {
              select: {
                id: true,
              },
            },
            quizzes: {
              select: {
                id: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    for (const activeStudyPlan of activeStudyPlans) {
      await this.prepareScheduledStudyDayMaterialBatchForPlan(activeStudyPlan);
    }
  }

  private async prepareScheduledStudyDayMaterialBatchForPlan(activeStudyPlan: {
    id: string;
    goal_text: string;
    requested_range_text: string | null;
    current_day: number;
    outline_raw: unknown;
    plan_raw: unknown;
    study_days: Array<{
      id: string;
      day_number: number;
      day_contents: {
        id: string;
      } | null;
      quizzes: {
        id: string;
      } | null;
    }>;
  }) {
    const selectedCourseName = parseStoredStudyCourseName(activeStudyPlan.requested_range_text);
    const generatedStudyPlan = parseStoredGeneratedStudyPlan(activeStudyPlan.plan_raw);

    if (!selectedCourseName || !generatedStudyPlan) {
      return;
    }

    const targetStudyDay = [...activeStudyPlan.study_days]
      .sort((left, right) => left.day_number - right.day_number)
      .find(
        (studyDay) =>
          studyDay.day_number > activeStudyPlan.current_day &&
          !(studyDay.day_contents && studyDay.quizzes),
      );

    if (!targetStudyDay) {
      return;
    }

    const storedTemplateMetadata = this.extractStoredTemplateMetadata(activeStudyPlan.outline_raw);
    const cachedStudyDayMaterials =
      storedTemplateMetadata.planTemplateId
        ? await this.findStoredStudyDayMaterialTemplate(
            storedTemplateMetadata.planTemplateId,
            targetStudyDay.day_number,
          )
        : null;

    if (cachedStudyDayMaterials) {
      await this.persistGeneratedStudyDayMaterials(targetStudyDay.id, cachedStudyDayMaterials);

      const existingJob = await this.prismaService.study_day_material_jobs.findUnique({
        where: {
          study_day_uuid: targetStudyDay.id,
        },
      });

      if (existingJob && existingJob.status !== 'COMPLETED') {
        await this.markStudyDayMaterialJobCompleted(existingJob.id);
      }

      return;
    }

    const existingJob = await this.prismaService.study_day_material_jobs.findUnique({
      where: {
        study_day_uuid: targetStudyDay.id,
      },
    });

    if (
      existingJob?.generation_mode === 'BATCH' &&
      existingJob.status === 'PROCESSING' &&
      existingJob.batch_id
    ) {
      return;
    }

    const generatedStudyDay = generatedStudyPlan.days.find(
      (studyDay) => studyDay.dayNumber === targetStudyDay.day_number,
    );

    if (!generatedStudyDay) {
      return;
    }

    const requestedAt = new Date();
    const deadlineAt = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000);

    try {
      const startedBatch = await this.openAiService.startStudyDayMaterialsBatch({
        customId: `study-day-material-job-${targetStudyDay.id}`,
        planTitle: generatedStudyPlan.planTitle,
        goalText: generatedStudyPlan.goalText,
        selectedCourseName,
        studyDay: generatedStudyDay,
      });

      if (existingJob) {
        await this.prismaService.study_day_material_jobs.update({
          where: {
            id: existingJob.id,
          },
          data: {
            status: 'PROCESSING',
            generation_mode: 'BATCH',
            batch_id: startedBatch.batchId,
            batch_status: 'PENDING',
            requested_at: requestedAt,
            deadline_at: deadlineAt,
            last_attempted_at: requestedAt,
            attempt_count: existingJob.attempt_count + 1,
            last_error_text: null,
          },
        });
      } else {
        await this.prismaService.study_day_material_jobs.create({
          data: {
            study_plan_uuid: activeStudyPlan.id,
            study_day_uuid: targetStudyDay.id,
            study_day_number: targetStudyDay.day_number,
            status: 'PROCESSING',
            generation_mode: 'BATCH',
            batch_id: startedBatch.batchId,
            batch_status: 'PENDING',
            requested_at: requestedAt,
            deadline_at: deadlineAt,
            last_attempted_at: requestedAt,
            attempt_count: 1,
          },
        });
      }
    } catch (error) {
      const readableError = this.getReadableStudyPlanErrorReason(error);

      if (existingJob) {
        await this.prismaService.study_day_material_jobs.update({
          where: {
            id: existingJob.id,
          },
          data: {
            status: 'FAILED',
            generation_mode: 'BATCH',
            batch_status: 'FAILED',
            requested_at: requestedAt,
            deadline_at: deadlineAt,
            last_attempted_at: requestedAt,
            attempt_count: existingJob.attempt_count + 1,
            last_error_text: readableError,
          },
        });
      } else {
        await this.prismaService.study_day_material_jobs.create({
          data: {
            study_plan_uuid: activeStudyPlan.id,
            study_day_uuid: targetStudyDay.id,
            study_day_number: targetStudyDay.day_number,
            status: 'FAILED',
            generation_mode: 'BATCH',
            batch_status: 'FAILED',
            requested_at: requestedAt,
            deadline_at: deadlineAt,
            last_attempted_at: requestedAt,
            attempt_count: 1,
            last_error_text: readableError,
          },
        });
      }
    }
  }

  // Enqueues material-generation jobs for study days that still need content and quizzes.
  // 아직 자료가 없는 학습 일차들에 대해 후속 생성 작업 큐를 적재한다.
  private async enqueueStudyDayMaterialGenerationJobs(
    studyPlanUuid: string,
    studyDayUuids: string[],
  ) {
    for (const studyDayUuid of studyDayUuids) {
      const existingJob = await this.prismaService.study_day_material_jobs.findUnique({
        where: {
          study_day_uuid: studyDayUuid,
        },
      });

      if (existingJob) {
        continue;
      }

      const studyDay = await this.prismaService.study_days.findUnique({
        where: {
          id: studyDayUuid,
        },
        select: {
          day_number: true,
        },
      });

      if (!studyDay) {
        continue;
      }

      await this.prismaService.study_day_material_jobs.create({
        data: {
          study_plan_uuid: studyPlanUuid,
          study_day_uuid: studyDayUuid,
          study_day_number: studyDay.day_number,
          generation_mode: 'REALTIME',
          requested_at: new Date(),
        },
      });
    }
  }

  // Processes queued material-generation jobs for a single study plan without failing the whole flow.
  // 하나의 학습 계획에 걸린 후속 자료 생성 작업을 처리하되 전체 시작 흐름은 실패시키지 않는다.
  private async processQueuedStudyDayMaterialJobsForPlan(studyPlanUuid: string, guild?: Guild) {
    const queuedJobs = await this.prismaService.study_day_material_jobs.findMany({
      where: {
        study_plan_uuid: studyPlanUuid,
        status: {
          in: ['PENDING', 'FAILED'],
        },
        OR: [
          {
            generation_mode: null,
          },
          {
            generation_mode: {
              not: 'BATCH',
            },
          },
        ],
      },
      orderBy: {
        created_at: 'asc',
      },
      include: {
        study_days: true,
        study_plans: true,
      },
    });

    await this.processQueuedStudyDayMaterialJobsWithConcurrency(queuedJobs, guild, true);
  }

  // Processes queued material-generation jobs for one guild on the background scheduler.
  // 하나의 서버에 속한 후속 자료 생성 작업 큐를 백그라운드 스케줄러에서 처리한다.
  async processQueuedStudyDayMaterialJobs(guild: Guild) {
    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: guild.id,
      },
    });

    if (!guildRecord) {
      return;
    }

    const queuedJobs = await this.prismaService.study_day_material_jobs.findMany({
      where: {
        status: {
          in: ['PENDING', 'FAILED'],
        },
        OR: [
          {
            generation_mode: null,
          },
          {
            generation_mode: {
              not: 'BATCH',
            },
          },
        ],
        study_plans: {
          guild_uuid: guildRecord.id,
          status: 'ACTIVE',
        },
      },
      orderBy: {
        created_at: 'asc',
      },
      include: {
        study_days: true,
        study_plans: true,
      },
    });

    await this.processQueuedStudyDayMaterialJobsWithConcurrency(queuedJobs, guild, false);
  }

  async processPendingStudyDayMaterialBatches(guild: Guild) {
    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: guild.id,
      },
    });

    if (!guildRecord) {
      return;
    }

    const batchJobs = await this.prismaService.study_day_material_jobs.findMany({
      where: {
        generation_mode: 'BATCH',
        status: 'PROCESSING',
        batch_id: {
          not: null,
        },
        study_plans: {
          guild_uuid: guildRecord.id,
        },
      },
      include: {
        study_days: true,
        study_plans: true,
      },
      orderBy: {
        requested_at: 'asc',
      },
    });

    for (const batchJob of batchJobs) {
      await this.processOneStudyDayMaterialBatchJob(batchJob, guild);
    }
  }

  private async processOneStudyDayMaterialBatchJob(
    queuedJob: {
      id: string;
      study_day_uuid: string;
      batch_id: string | null;
      study_days: {
        id: string;
        day_number: number;
      };
      study_plans: {
        id: string;
        status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
        start_date: Date | null;
        requested_range_text: string | null;
        outline_raw: unknown;
      };
    },
    guild?: Guild,
  ) {
    if (!queuedJob.batch_id) {
      return;
    }

    try {
      const existingDayContent = await this.prismaService.day_contents.findUnique({
        where: {
          study_day_uuid: queuedJob.study_day_uuid,
        },
      });
      const existingQuiz = await this.prismaService.quizzes.findUnique({
        where: {
          study_day_uuid: queuedJob.study_day_uuid,
        },
      });

      if (existingDayContent && existingQuiz) {
        await this.markStudyDayMaterialJobCompleted(queuedJob.id);
        return;
      }

      const batchResult = await this.openAiService.getStudyDayMaterialsBatchResult(
        queuedJob.batch_id,
      );

      if (batchResult.status === 'PENDING') {
        await this.prismaService.study_day_material_jobs.update({
          where: {
            id: queuedJob.id,
          },
          data: {
            batch_status: batchResult.batchStatus,
          },
        });
        return;
      }

      if (batchResult.status === 'COMPLETED') {
        const storedTemplateMetadata = this.extractStoredTemplateMetadata(
          queuedJob.study_plans.outline_raw,
        );

        if (storedTemplateMetadata.planTemplateId) {
          await this.storeStudyDayMaterialTemplate(
            storedTemplateMetadata.planTemplateId,
            queuedJob.study_days.day_number,
            batchResult.generatedMaterials,
          );
        }

        await this.persistGeneratedStudyDayMaterials(
          queuedJob.study_day_uuid,
          batchResult.generatedMaterials,
        );
        await this.markStudyDayMaterialJobCompleted(queuedJob.id);

        const shouldSendSuccessNotice = await this.shouldSendStudyDayMaterialGenerationNotice(
          queuedJob.study_plans.id,
        );

        if (!shouldSendSuccessNotice) {
          return;
        }

        await this.sendStudyDayMaterialGenerationNotice(
          guild,
          this.createStudyDayMaterialGenerationNoticeMessage(
            queuedJob.study_plans.start_date,
            queuedJob.study_plans.requested_range_text,
            queuedJob.study_days.day_number,
            'success',
          ),
        );
        return;
      }

      await this.prismaService.study_day_material_jobs.update({
        where: {
          id: queuedJob.id,
        },
        data: {
          status: 'FAILED',
          batch_status: batchResult.batchStatus,
          last_error_text: batchResult.detail,
        },
      });

      const shouldSendFailureNotice = await this.shouldSendStudyDayMaterialGenerationNotice(
        queuedJob.study_plans.id,
      );

      if (!shouldSendFailureNotice) {
        return;
      }

      await this.sendStudyDayMaterialGenerationNotice(
        guild,
        this.createStudyDayMaterialGenerationNoticeMessage(
          queuedJob.study_plans.start_date,
          queuedJob.study_plans.requested_range_text,
          queuedJob.study_days.day_number,
          'failure',
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to poll batch study day materials for plan ${queuedJob.study_plans.id} day ${queuedJob.study_days.day_number}`,
        error,
      );

      await this.prismaService.study_day_material_jobs.update({
        where: {
          id: queuedJob.id,
        },
        data: {
          status: 'FAILED',
          batch_status: 'FAILED',
          last_error_text: this.getReadableStudyPlanErrorReason(error),
        },
      });
    }
  }

  private async processQueuedStudyDayMaterialJobsWithConcurrency(
    queuedJobs: Array<{
      id: string;
      status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      attempt_count: number;
      study_day_uuid: string;
      generation_mode: string | null;
      study_days: {
        id: string;
        day_number: number;
        title: string;
        topic_summary: string;
        learning_goal: string;
        scope_text: string | null;
      };
      study_plans: {
        id: string;
        status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
        goal_text: string;
        requested_range_text: string | null;
        start_date: Date | null;
        outline_raw: unknown;
        plan_raw: unknown;
      };
    }>,
    guild?: Guild,
    preserveNoticeOrder = false,
  ) {
    if (queuedJobs.length === 0) {
      return;
    }

    let nextJobIndex = 0;
    const queuedNotices = [] as Array<{ index: number; content: string }>;
    const workerCount = Math.min(this.studyDayMaterialJobConcurrency, queuedJobs.length);

    const worker = async () => {
      while (true) {
        const currentJobIndex = nextJobIndex;

        if (currentJobIndex >= queuedJobs.length) {
          return;
        }

        nextJobIndex += 1;
        const queuedJob = queuedJobs[currentJobIndex];
        const noticeContent = await this.processOneStudyDayMaterialJob(queuedJob, guild, {
          suppressNotice: preserveNoticeOrder,
        });

        if (noticeContent) {
          queuedNotices.push({
            index: currentJobIndex,
            content: noticeContent,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (!preserveNoticeOrder) {
      return;
    }

    for (const queuedNotice of [...queuedNotices].sort((left, right) => left.index - right.index)) {
      await this.sendStudyDayMaterialGenerationNotice(guild, queuedNotice.content);
    }
  }

  // Processes one queued study-day material job and stores success or failure back into the queue table.
  // 큐에 적재된 하루치 자료 생성 작업 하나를 수행하고 성공/실패 결과를 큐 테이블에 반영한다.
  private async processOneStudyDayMaterialJob(queuedJob: {
    id: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    attempt_count: number;
    study_day_uuid: string;
    generation_mode: string | null;
    study_days: {
      id: string;
      day_number: number;
      title: string;
      topic_summary: string;
      learning_goal: string;
      scope_text: string | null;
    };
    study_plans: {
      id: string;
      status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
      goal_text: string;
      requested_range_text: string | null;
      start_date: Date | null;
      outline_raw: unknown;
      plan_raw: unknown;
    };
  }, guild?: Guild, options?: { suppressNotice?: boolean }) {
    const claimedJobCount = await this.prismaService.study_day_material_jobs.updateMany({
      where: {
        id: queuedJob.id,
        status: queuedJob.status,
      },
      data: {
        status: 'PROCESSING',
        attempt_count: queuedJob.attempt_count + 1,
        last_attempted_at: new Date(),
        generation_mode: queuedJob.generation_mode ?? 'REALTIME',
      },
    });

    if (claimedJobCount.count === 0) {
      return null;
    }

    try {
      const existingDayContent = await this.prismaService.day_contents.findUnique({
        where: {
          study_day_uuid: queuedJob.study_day_uuid,
        },
      });
      const existingQuiz = await this.prismaService.quizzes.findUnique({
        where: {
          study_day_uuid: queuedJob.study_day_uuid,
        },
      });

      if (existingDayContent && existingQuiz) {
        await this.markStudyDayMaterialJobCompleted(queuedJob.id);
        return null;
      }

      const selectedCourseName = parseStoredStudyCourseName(
        queuedJob.study_plans.requested_range_text,
      );

      if (!selectedCourseName) {
        throw new Error('선택된 코스 정보를 확인할 수 없습니다.');
      }

      const generatedStudyPlan = parseStoredGeneratedStudyPlan(queuedJob.study_plans.plan_raw);

      if (!generatedStudyPlan) {
        throw new Error('저장된 상세 학습 계획을 확인할 수 없습니다.');
      }

      const generatedStudyDay = generatedStudyPlan.days.find(
        (studyDay) => studyDay.dayNumber === queuedJob.study_days.day_number,
      );

      if (!generatedStudyDay) {
        throw new Error(`${queuedJob.study_days.day_number}일차 계획 정보를 찾을 수 없습니다.`);
      }

      const storedTemplateMetadata = this.extractStoredTemplateMetadata(
        queuedJob.study_plans.outline_raw,
      );
      const cachedStudyDayMaterials =
        storedTemplateMetadata.planTemplateId
          ? await this.findStoredStudyDayMaterialTemplate(
              storedTemplateMetadata.planTemplateId,
              queuedJob.study_days.day_number,
            )
          : null;

      const generatedMaterials =
        cachedStudyDayMaterials ??
        (await this.openAiService.getStudyDayMaterials(
          generatedStudyPlan.planTitle,
          generatedStudyPlan.goalText,
          selectedCourseName,
          generatedStudyDay,
        ));

      if (!cachedStudyDayMaterials && storedTemplateMetadata.planTemplateId) {
        await this.storeStudyDayMaterialTemplate(
          storedTemplateMetadata.planTemplateId,
          queuedJob.study_days.day_number,
          generatedMaterials,
        );
      }

      await this.persistGeneratedStudyDayMaterials(queuedJob.study_day_uuid, generatedMaterials);
      await this.markStudyDayMaterialJobCompleted(queuedJob.id);
      const successNotice = this.createStudyDayMaterialGenerationNoticeMessage(
        queuedJob.study_plans.start_date,
        queuedJob.study_plans.requested_range_text,
        queuedJob.study_days.day_number,
        'success',
      );

      const shouldSendSuccessNotice = await this.shouldSendStudyDayMaterialGenerationNotice(
        queuedJob.study_plans.id,
      );

      if (!shouldSendSuccessNotice) {
        return null;
      }

      if (options?.suppressNotice) {
        return successNotice;
      }

      await this.sendStudyDayMaterialGenerationNotice(guild, successNotice);
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to generate queued study day materials for plan ${queuedJob.study_plans.id} day ${queuedJob.study_days.day_number}`,
        error,
      );
      await this.prismaService.study_day_material_jobs.update({
        where: {
          id: queuedJob.id,
        },
        data: {
          status: 'FAILED',
          last_error_text: this.getReadableStudyPlanErrorReason(error),
            batch_status: null,
          },
        });
      const failureNotice = this.createStudyDayMaterialGenerationNoticeMessage(
        queuedJob.study_plans.start_date,
        queuedJob.study_plans.requested_range_text,
        queuedJob.study_days.day_number,
        'failure',
      );

      const shouldSendFailureNotice = await this.shouldSendStudyDayMaterialGenerationNotice(
        queuedJob.study_plans.id,
      );

      if (!shouldSendFailureNotice) {
        return null;
      }

      if (options?.suppressNotice) {
        return failureNotice;
      }

      await this.sendStudyDayMaterialGenerationNotice(guild, failureNotice);
      return null;
    }
  }

  // Marks one queued material-generation job as completed after the generated data is persisted.
  // 생성된 자료가 저장된 뒤 해당 큐 작업을 완료 상태로 표시한다.
  private async markStudyDayMaterialJobCompleted(studyDayMaterialJobUuid: string) {
    await this.prismaService.study_day_material_jobs.update({
      where: {
        id: studyDayMaterialJobUuid,
      },
      data: {
        status: 'COMPLETED',
        completed_at: new Date(),
        last_error_text: null,
        ready_at: new Date(),
        batch_status: null,
      },
    });
  }

  private async sendStudyDayMaterialGenerationNotice(guild: Guild | undefined, content: string) {
    if (!guild) {
      return;
    }

    try {
      const studyPlanChannel = await this.getStudyPlanTextChannel(guild);

      if (!studyPlanChannel.isSendable()) {
        return;
      }

      for (const contentChunk of this.splitDiscordMessageContent(content)) {
        await studyPlanChannel.send(contentChunk);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to send study-day material notice in guild ${guild.id}: ${this.getReadableStudyPlanErrorReason(error)}`,
      );
    }
  }

  private async reportMissingDiscordChannel(guild: Guild, error: MissingDiscordChannelError) {
    if (error.channelName === 'db_study_plan') {
      this.logger.warn(
        `Failed to notify missing Discord channel because db_study_plan is missing in guild ${guild.id}.`,
      );
      return;
    }

    try {
      const studyPlanChannel = await this.getStudyPlanTextChannel(guild);

      if (!studyPlanChannel.isSendable()) {
        return;
      }

      await studyPlanChannel.send(
        [
          '**[채널 누락 오류]**',
          `\`${error.channelName}\` ${error.channelType === 'forum' ? '포럼' : '텍스트'} 채널이 없어 전송에 실패했습니다.`,
          '채널을 다시 생성하거나 이름을 원래대로 맞춰주세요.',
        ].join('\n'),
      );
    } catch (sendError) {
      this.logger.warn(
        `Failed to report missing channel ${error.channelName} in guild ${guild.id}: ${this.getReadableStudyPlanErrorReason(sendError)}`,
      );
    }
  }

  private async moveStudyPlanToCancelledListAfterMissingChannel(
    guild: Guild,
    studyPlanId: string,
    options?: {
      resetToBeforeFirstDay?: boolean;
    },
  ) {
    const shouldResetToBeforeFirstDay = options?.resetToBeforeFirstDay ?? false;

    await this.prismaService.$transaction(async (tx) => {
      await tx.study_plans.update({
        where: {
          id: studyPlanId,
        },
        data: {
          status: 'CANCELLED',
          next_publish_at: null,
          ...(shouldResetToBeforeFirstDay
            ? {
                current_day: 0,
              }
            : {}),
        },
      });

      if (shouldResetToBeforeFirstDay) {
        await tx.study_days.updateMany({
          where: {
            study_plan_uuid: studyPlanId,
            day_number: 1,
            status: 'IN_PROGRESS',
          },
          data: {
            status: 'PENDING',
          },
        });
      }
    });

    try {
      const studyPlanChannel = await this.getStudyPlanTextChannel(guild);

      if (!studyPlanChannel.isSendable()) {
        return;
      }

      await studyPlanChannel.send(
        [
          '해당 코스를 중단리스트로 이동했습니다.',
          '채널을 다시 생성한 뒤 중단리스트에서 재시작해주세요.',
        ].join('\n'),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send cancelled-list guidance after missing channel in guild ${guild.id}: ${this.getReadableStudyPlanErrorReason(error)}`,
      );
    }
  }

  private async shouldSendStudyDayMaterialGenerationNotice(studyPlanUuid: string) {
    const currentStudyPlan = await this.prismaService.study_plans.findUnique({
      where: {
        id: studyPlanUuid,
      },
      select: {
        status: true,
      },
    });

    return currentStudyPlan?.status === 'ACTIVE';
  }

  private async sendSpoilerCodeBlockReply(message: Message, content: string) {
    const contentChunks = this.splitDiscordMessageContent(content, 1800).map((contentChunk) =>
      this.formatDiscordSpoilerCodeBlock(contentChunk),
    );

    const firstReply = await message.reply(contentChunks[0]);

    if (!message.channel.isSendable()) {
      return firstReply.id;
    }

    for (const contentChunk of contentChunks.slice(1)) {
      await message.channel.send(contentChunk);
    }

    return firstReply.id;
  }

  private formatDiscordSpoilerCodeBlock(content: string) {
    return `||${this.formatDiscordCodeBlock(content)}||`;
  }

  private formatDiscordCodeBlock(content: string, language?: string) {
    const escapedContent = content.replace(/```/g, '``\u200b`');
    const normalizedLanguage = this.resolveDiscordCodeBlockLanguage(content, language);
    return `\`\`\`${normalizedLanguage}\n${escapedContent}\n\`\`\``;
  }

  private resolveDiscordCodeBlockLanguage(content: string, language?: string) {
    const normalizedLanguage = language?.trim();

    if (normalizedLanguage) {
      return normalizedLanguage;
    }

    const normalizedContent = content.trim().toUpperCase();

    if (
      /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE|MERGE|UPSERT)\b/.test(
        normalizedContent,
      )
    ) {
      return 'sql';
    }

    return 'txt';
  }

  private createStudyDayMaterialGenerationNoticeMessage(
    startedAt: Date | null,
    storedCourseName: string | null,
    dayNumber: number,
    status: 'success' | 'failure',
  ) {
    const startedDateText = formatStartedDate(startedAt ?? new Date());
    const selectedCourseName =
      parseStoredStudyCourseName(storedCourseName) ?? storedCourseName ?? '알 수 없는';
    const messagePrefix = `[${startedDateText} 시작 ${selectedCourseName} 코스]`;

    if (status === 'success') {
      return `${messagePrefix} ${dayNumber}일차 학습 자료를 생성했습니다.`;
    }

    return `${messagePrefix} ${dayNumber}일차 학습 자료를 생성하는데 실패했습니다. 10분후에 다시 시도해보겠습니다.`;
  }

  // Publishes the next study day when its materials have already been generated.
  // 다음 일차 자료가 이미 생성되어 있으면 Discord에 게시하고 진행 상태를 업데이트한다.
  private async publishNextStudyDayIfReady(
    guild: Guild,
    activeStudyPlan: {
      id: string;
      goal_text: string;
      current_day: number;
      total_days: number;
      created_at: Date;
      requested_range_text: string | null;
      outline_raw?: unknown;
      study_days: Array<{
        id: string;
        day_number: number;
        title: string;
        topic_summary: string;
        learning_goal: string;
        scope_text: string | null;
        day_contents: {
          id: string;
          summary_text: string | null;
          content_text: string;
          discord_message_id: string | null;
          published_at: Date | null;
        } | null;
        quizzes: {
          id: string;
          intro_text: string | null;
          discord_message_id: string | null;
          published_at: Date | null;
          quiz_items: Array<{
            id: string;
            question_no: number;
            prompt_text: string;
            expected_points: unknown;
            model_answer_text: string;
            explanation_text: string;
            quiz_hints: Array<{
              id: string;
              hint_no: number;
              hint_text: string;
            }>;
          }>;
        } | null;
      }>;
    },
    selectedCourseName: StudyCourseName,
    generatedStudyPlan: GeneratedStudyPlan,
    targetDayNumber: number,
  ) : Promise<boolean> {
    const targetStudyDay = await this.ensureStudyDayMaterialsReadyForPublishing(
      activeStudyPlan,
      selectedCourseName,
      generatedStudyPlan,
      targetDayNumber,
    );

    if (!targetStudyDay?.day_contents || !targetStudyDay.quizzes) {
      return false;
    }

    if (targetStudyDay.day_contents.published_at || targetStudyDay.quizzes.published_at) {
      return false;
    }

    const generatedStudyDay = generatedStudyPlan.days.find(
      (studyDay) => studyDay.dayNumber === targetDayNumber,
    );

    if (!generatedStudyDay) {
      return false;
    }

    const generatedMaterials = buildGeneratedStudyDayMaterialsFromStoredDay(targetStudyDay);
    let publishedThreadIds;

    try {
      publishedThreadIds = await this.publishStudyDayThreads(
        guild,
        selectedCourseName,
        activeStudyPlan.created_at,
        generatedStudyDay,
        generatedMaterials,
      );
    } catch (error) {
      if (error instanceof MissingDiscordChannelError) {
        await this.moveStudyPlanToCancelledListAfterMissingChannel(guild, activeStudyPlan.id);
        return false;
      }

      throw error;
    }

    await this.updatePublishedDiscordMessages(
      {
        studyDayId: targetStudyDay.id,
        dayContentId: targetStudyDay.day_contents.id,
        quizId: targetStudyDay.quizzes.id,
      },
      publishedThreadIds,
    );

    await this.prismaService.$transaction([
      this.prismaService.study_plans.update({
        where: {
          id: activeStudyPlan.id,
        },
        data: {
          current_day: targetDayNumber,
          next_publish_at:
            targetDayNumber < activeStudyPlan.total_days
              ? this.createNextScheduledPublishAt(new Date())
              : null,
        },
      }),
      this.prismaService.study_days.updateMany({
        where: {
          study_plan_uuid: activeStudyPlan.id,
          day_number: targetDayNumber - 1,
          status: 'IN_PROGRESS',
        },
        data: {
          status: 'COMPLETED',
        },
      }),
      this.prismaService.study_days.update({
        where: {
          id: targetStudyDay.id,
        },
        data: {
          status: 'IN_PROGRESS',
        },
      }),
    ]);

    return true;
  }

  private async ensureStudyDayMaterialsReadyForPublishing(
    activeStudyPlan: {
      id: string;
      goal_text: string;
      requested_range_text: string | null;
      outline_raw?: unknown;
      study_days: Array<{
        id: string;
        day_number: number;
        title: string;
        topic_summary: string;
        learning_goal: string;
        scope_text: string | null;
        day_contents: {
          id: string;
          summary_text: string | null;
          content_text: string;
          discord_message_id: string | null;
          published_at: Date | null;
        } | null;
        quizzes: {
          id: string;
          intro_text: string | null;
          discord_message_id: string | null;
          published_at: Date | null;
          quiz_items: Array<{
            id: string;
            question_no: number;
            prompt_text: string;
            expected_points: unknown;
            model_answer_text: string;
            explanation_text: string;
            quiz_hints: Array<{
              id: string;
              hint_no: number;
              hint_text: string;
            }>;
          }>;
        } | null;
      }>;
    },
    selectedCourseName: StudyCourseName,
    generatedStudyPlan: GeneratedStudyPlan,
    targetDayNumber: number,
  ) {
    const existingTargetStudyDay = activeStudyPlan.study_days.find(
      (studyDay) => studyDay.day_number === targetDayNumber,
    );

    if (!existingTargetStudyDay) {
      return null;
    }

    if (existingTargetStudyDay.day_contents && existingTargetStudyDay.quizzes) {
      return existingTargetStudyDay;
    }

    const generatedStudyDay = generatedStudyPlan.days.find(
      (studyDay) => studyDay.dayNumber === targetDayNumber,
    );

    if (!generatedStudyDay) {
      return null;
    }

    const storedTemplateMetadata = this.extractStoredTemplateMetadata(activeStudyPlan.outline_raw);
    const cachedStudyDayMaterials =
      storedTemplateMetadata.planTemplateId
        ? await this.findStoredStudyDayMaterialTemplate(
            storedTemplateMetadata.planTemplateId,
            targetDayNumber,
          )
        : null;
    const generatedMaterials =
      cachedStudyDayMaterials ??
      (await this.openAiService.getStudyDayMaterials(
        generatedStudyPlan.planTitle,
        activeStudyPlan.goal_text,
        selectedCourseName,
        generatedStudyDay,
      ));

    if (!cachedStudyDayMaterials && storedTemplateMetadata.planTemplateId) {
      await this.storeStudyDayMaterialTemplate(
        storedTemplateMetadata.planTemplateId,
        targetDayNumber,
        generatedMaterials,
      );
    }

    await this.persistGeneratedStudyDayMaterials(existingTargetStudyDay.id, generatedMaterials);

    const existingJob = await this.prismaService.study_day_material_jobs.findUnique({
      where: {
        study_day_uuid: existingTargetStudyDay.id,
      },
    });

    if (existingJob && existingJob.status !== 'COMPLETED') {
      await this.markStudyDayMaterialJobCompleted(existingJob.id);
    }

    return this.prismaService.study_days.findUnique({
      where: {
        id: existingTargetStudyDay.id,
      },
      include: {
        day_contents: true,
        quizzes: {
          include: {
            quiz_items: {
              include: {
                quiz_hints: true,
              },
            },
          },
        },
      },
    });
  }

  // Builds a fallback scheduled date when the stored per-day date is not available yet.
  // 일차별 저장된 날짜가 없을 때 시작일과 일차 번호로 기본 게시 날짜를 계산한다.
  private createFallbackScheduledDate(startDate: Date | null, dayNumber: number) {
    if (!startDate) {
      return null;
    }

    const fallbackScheduledDate = new Date(startDate);
    fallbackScheduledDate.setDate(fallbackScheduledDate.getDate() + (dayNumber - 1));

    return fallbackScheduledDate;
  }

  // Marks the plan completed 15 minutes after the final study day has been published.
  // 마지막 일차가 게시된 뒤 15분이 지나면 해당 계획을 완료 처리한다.
  private async completeStudyPlanIfLastDayElapsed(studyPlanId: string) {
    const targetStudyPlan = await this.prismaService.study_plans.findUnique({
      where: {
        id: studyPlanId,
      },
      include: {
        study_days: {
          orderBy: {
            day_number: 'desc',
          },
          take: 1,
          include: {
            day_contents: true,
          },
        },
      },
    });

    if (!targetStudyPlan || targetStudyPlan.status !== 'ACTIVE') {
      return;
    }

    const lastStudyDay = targetStudyPlan.study_days[0];

    if (!lastStudyDay?.day_contents?.published_at) {
      return;
    }

    if (targetStudyPlan.current_day < targetStudyPlan.total_days) {
      return;
    }

    if (
      Date.now() <
      lastStudyDay.day_contents.published_at.getTime() + this.automatedCompletionDelayMs
    ) {
      return;
    }

    await this.prismaService.$transaction([
      this.prismaService.study_plans.update({
        where: {
          id: targetStudyPlan.id,
        },
        data: {
          status: 'COMPLETED',
          next_publish_at: null,
        },
      }),
      this.prismaService.study_days.updateMany({
        where: {
          study_plan_uuid: targetStudyPlan.id,
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
        },
        data: {
          status: 'COMPLETED',
        },
      }),
    ]);
  }

  // Persists generated materials for one study day that has not been published yet.
  // 아직 게시되지 않은 특정 일차의 생성 결과를 DB에 저장한다.
  private async persistGeneratedStudyDayMaterials(
    studyDayUuid: string,
    generatedMaterials: GeneratedStudyDayMaterials,
  ) {
    await this.prismaService.$transaction(async (tx) => {
      const existingDayContent = await tx.day_contents.findUnique({
        where: {
          study_day_uuid: studyDayUuid,
        },
      });

      if (!existingDayContent) {
        await tx.day_contents.create({
          data: {
            study_day_uuid: studyDayUuid,
            summary_text: generatedMaterials.summaryText,
            content_text: generatedMaterials.contentText,
            llm_raw: generatedMaterials,
          },
        });
      }

      const existingQuiz = await tx.quizzes.findUnique({
        where: {
          study_day_uuid: studyDayUuid,
        },
      });

      if (existingQuiz) {
        return;
      }

      const createdQuiz = await tx.quizzes.create({
        data: {
          study_day_uuid: studyDayUuid,
          intro_text: generatedMaterials.quizIntroText,
        },
      });

      for (const quizItem of generatedMaterials.quizItems) {
        const createdQuizItem = await tx.quiz_items.create({
          data: {
            quiz_uuid: createdQuiz.id,
            question_no: quizItem.questionNo,
            prompt_text: quizItem.promptText,
            expected_points: quizItem.expectedPoints,
            model_answer_text: quizItem.modelAnswerText,
            explanation_text: quizItem.explanationText,
          },
        });

        for (const [hintIndex, hintText] of quizItem.hintTexts.entries()) {
          await tx.quiz_hints.create({
            data: {
              quiz_item_uuid: createdQuizItem.id,
              hint_no: hintIndex + 1,
              hint_text: hintText,
              llm_raw: {
                questionNo: quizItem.questionNo,
              },
            },
          });
        }
      }
    });
  }

  // Rebuilds the generated-material shape from stored DB rows so it can be published again.
  // DB에 저장된 일차 자료를 다시 게시할 수 있도록 생성 결과 형태로 복원한다.
  private buildGeneratedStudyDayMaterialsFromStoredDay(studyDay: {
    day_contents: {
      summary_text: string | null;
      content_text: string;
    } | null;
    quizzes: {
      intro_text: string | null;
      quiz_items: Array<{
        question_no: number;
        prompt_text: string;
        expected_points: unknown;
        model_answer_text: string;
        explanation_text: string;
        quiz_hints: Array<{
          hint_no: number;
          hint_text: string;
        }>;
      }>;
    } | null;
  }): GeneratedStudyDayMaterials {
    if (!studyDay.day_contents || !studyDay.quizzes) {
      throw new Error('Stored study day materials are incomplete.');
    }

    return {
      summaryText: studyDay.day_contents.summary_text ?? '',
      contentText: studyDay.day_contents.content_text,
      quizIntroText: studyDay.quizzes.intro_text ?? '',
      quizItems: studyDay.quizzes.quiz_items.map((quizItem) => ({
        questionNo: quizItem.question_no,
        promptText: quizItem.prompt_text,
        expectedPoints: Array.isArray(quizItem.expected_points)
          ? quizItem.expected_points.map((point) => String(point))
          : [],
        hintTexts: [...quizItem.quiz_hints]
          .sort((leftHint, rightHint) => leftHint.hint_no - rightHint.hint_no)
          .map((quizHint) => quizHint.hint_text),
        modelAnswerText: quizItem.model_answer_text,
        explanationText: quizItem.explanation_text,
      })),
    };
  }

  // Handles study questions posted inside a user_ask forum thread.
  // user_ask 포럼 스레드 안에 올라온 학습 질문 메시지를 처리한다.
  async handleUserAskQuestion(message: Message) {
    if (!message.channel.isThread()) {
      return;
    }

    const parsedQuestionText = parseStudyQuestionCommand(message.content);

    if (!parsedQuestionText) {
      await message.reply(
        [
          '질문 형식이 올바르지 않습니다.',
          '질문은 하루에 최대 10번까지 가능합니다.',
          '아래 형식으로 다시 작성해주세요.',
          '!질문 서브쿼리와 조인 차이를 오늘 내용 기준으로 다시 설명해주세요.',
        ].join('\n'),
      );
      return;
    }

    const studyQuestionContext =
      (await this.findStudyQuestionContextByChannelId(message)) ??
      (await this.findStudyQuestionContext(message, parseUserAskThreadContext(message.channel.name)));

    if (!studyQuestionContext) {
      await message.reply('현재 학습 자료를 찾을 수 없어 답변을 진행할 수 없습니다.');
      return;
    }

    if (studyQuestionContext.studyPlan.status !== 'ACTIVE') {
      await this.sendInactivePlanNotice(message, studyQuestionContext.studyPlan.status, 5 * 60 * 1000);
      return;
    }

    const guildRecord = await this.ensureDiscordGuild(message);
    const memberRecord = await this.ensureDiscordMember(message, guildRecord.id);
    const todayQuestionCount = await this.prismaService.lesson_questions.count({
      where: {
        study_day_uuid: studyQuestionContext.currentStudyDay.id,
        member_uuid: memberRecord.id,
      },
    });

    if (todayQuestionCount >= 10) {
      await message.reply('오늘 질문을 이미 10회 사용하셨습니다.');
      return;
    }

    const createdQuestion = await this.prismaService.lesson_questions.create({
      data: {
        study_day_uuid: studyQuestionContext.currentStudyDay.id,
        member_uuid: memberRecord.id,
        discord_channel_id: message.channel.id,
        discord_message_id: message.id,
        question_text: parsedQuestionText,
        normalized_text: parsedQuestionText,
      },
    });

    const answerResult = await this.openAiService.answerStudyQuestion(
      parsedQuestionText,
      this.buildStudyQuestionContextText(studyQuestionContext),
    );

    const finalAnswerText = answerResult.canAnswer
      ? answerResult.answerText
      : '해당 질문은 학습내용과는 관계가 없는 것 같아 답변을 드릴 수 없습니다. 죄송합니다.';

    const postedAnswerMessageId = await this.sendSpoilerCodeBlockReply(message, finalAnswerText);

    await this.prismaService.lesson_answers.create({
      data: {
        question_uuid: createdQuestion.id,
        answer_text: finalAnswerText,
        answer_source_type: 'GENERATED',
        discord_message_id: postedAnswerMessageId,
        llm_raw: answerResult,
      },
    });

    await this.prismaService.lesson_questions.update({
      where: {
        id: createdQuestion.id,
      },
      data: {
        status: 'ANSWERED',
      },
    });

  }

  // Handles top-level study plan commands that should work regardless of the current conversation state.
  // 현재 대화 상태와 무관하게 동작해야 하는 상위 학습 계획 명령을 처리한다.
  private async handleStudyPlanCommand(
    message: Message,
    rawContent: string,
    currentConversationState: StudyPlanConversationState | null,
  ) {
    if (rawContent === '-h') {
      await this.sendChannelMessage(message, discordStudyPlanHelpMessage);
      return true;
    }

    if (rawContent === '리스트') {
      this.pushStudyPlanListOverlay(message.guildId, 'ACTIVE', currentConversationState);
      await this.sendStudyPlanList(message, 'ACTIVE');
      return true;
    }

    if (rawContent === '중단리스트') {
      this.pushStudyPlanListOverlay(message.guildId, 'CANCELLED', currentConversationState);
      await this.sendStudyPlanList(message, 'CANCELLED');
      return true;
    }

    const selectedStopPlanNumber = parseStopPlanSelection(rawContent);

    if (
      selectedStopPlanNumber !== null &&
      currentConversationState?.stage !== 'AWAITING_EXISTING_PLAN_DECISION'
    ) {
      await this.stopActiveStudyPlan(message, selectedStopPlanNumber);
      return true;
    }

    const selectedArchivePlanNumber = parseArchivePlanSelection(rawContent);

    if (selectedArchivePlanNumber !== null) {
      await this.archiveCancelledStudyPlan(message, selectedArchivePlanNumber);
      return true;
    }

    const selectedResumePlanNumber = parseResumePlanSelection(rawContent);

    if (selectedResumePlanNumber !== null) {
      await this.resumeCancelledStudyPlan(message, selectedResumePlanNumber);
      return true;
    }

    if (rawContent === '완료리스트') {
      this.pushStudyPlanListOverlay(message.guildId, 'COMPLETED', currentConversationState);
      await this.sendStudyPlanList(message, 'COMPLETED');
      return true;
    }

    return false;
  }

  // Calls the LLM after the user confirms the study duration and posts the reply back to Discord.
  // 사용자가 학습 일수를 확정하면 난이도 선택 단계로 넘긴다.
  private async handleConfirmedDuration(message: Message, days: number) {
    const pendingPlanCreationMode = this.resolvePendingPlanCreationMode(message.guildId);

    if (message.guildId) {
      this.courseSelectionStates.set(message.guildId, {
        stage: 'AWAITING_COURSE_SELECTION',
        totalDays: days,
        creationMode: pendingPlanCreationMode.creationMode,
        activePlanIdsToCancel: pendingPlanCreationMode.activePlanIdsToCancel,
        courseSelectionSummaryText: discordFixedCourseSelectionSummaryText,
      });
      this.pendingPlanCreationModes.delete(message.guildId);
    }

    await this.sendChannelMessage(
      message,
      createDiscordCourseSelectionPromptMessage(days, discordFixedCourseSelectionSummaryText),
    );
  }

  // Handles an entered duration by checking for currently active study plans first.
  // 학습 기간 입력 시 현재 ACTIVE 학습이 있는지 먼저 확인하고 다음 단계를 결정한다.
  private async handleDurationEntry(message: Message, durationDays: number) {
    if (message.guildId) {
      this.pendingPlanCreationModes.delete(message.guildId);
      this.courseSelectionStates.delete(message.guildId);
    }

    const activeStudyPlans = await this.findActiveStudyPlans(message);

    if (activeStudyPlans.length < 3) {
      await this.handleConfirmedDuration(message, durationDays);
      return;
    }

    if (message.guildId) {
      this.courseSelectionStates.set(message.guildId, {
        stage: 'AWAITING_EXISTING_PLAN_DECISION',
        pendingDays: durationDays,
        activePlans: activeStudyPlans.map((studyPlan, index) => ({
          id: studyPlan.id,
          summaryLine: formatIndexedStudyPlanSummary(index + 1, studyPlan),
        })),
      });
    }

    await this.sendChannelMessage(
      message,
      createDiscordExistingStudyPlanPromptMessage(
        activeStudyPlans.map((studyPlan, index) =>
          formatIndexedStudyPlanSummary(index + 1, studyPlan),
        ),
      ),
    );
  }

  // Handles whether a new study should replace active plans or run in parallel.
  // 새 학습을 기존 ACTIVE 학습과 교체할지 병행할지 선택하는 입력을 처리한다.
  private async handleExistingPlanDecision(
    message: Message,
    existingPlanDecisionState: ExistingPlanDecisionState,
    rawContent: string,
  ) {
    if (rawContent === '취소') {
      if (message.guildId) {
        this.pendingPlanCreationModes.delete(message.guildId);
        this.courseSelectionStates.delete(message.guildId);
      }
      await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
      return;
    }

    const selectedStopPlanNumber = parseStopPlanSelection(rawContent);
    const selectedArchivePlanNumber = parseArchivePlanSelection(rawContent);

    if (selectedStopPlanNumber !== null) {
      const targetPlan = existingPlanDecisionState.activePlans[selectedStopPlanNumber - 1];

      if (!targetPlan) {
        await this.sendChannelMessage(message, createDiscordExistingStudyPlanInvalidSelectionMessage());
        await this.sendChannelMessage(
          message,
          createDiscordExistingStudyPlanPromptMessage(
            existingPlanDecisionState.activePlans.map((studyPlan) => studyPlan.summaryLine),
          ),
        );
        return;
      }

      const hasReachedCancelledPlanLimit = await this.hasReachedCancelledStudyPlanLimit(message);

      if (hasReachedCancelledPlanLimit) {
        await this.sendChannelMessage(message, discordCancelledStudyPlanLimitMessage);
        return;
      }

      await this.cancelStudyPlanById(targetPlan.id);
      if (message.guildId) {
        this.pendingPlanCreationModes.set(message.guildId, {
          creationMode: 'PARALLEL',
          activePlanIdsToCancel: [],
        });
      }

      await this.sendChannelMessage(
        message,
        `${selectedStopPlanNumber}번 코스를 중단하였습니다.`,
      );
      await this.handleConfirmedDuration(message, existingPlanDecisionState.pendingDays);
      return;
    }

    if (selectedArchivePlanNumber !== null) {
      const targetPlan = existingPlanDecisionState.activePlans[selectedArchivePlanNumber - 1];

      if (!targetPlan) {
        await this.sendChannelMessage(message, createDiscordExistingStudyPlanInvalidSelectionMessage());
        await this.sendChannelMessage(
          message,
          createDiscordExistingStudyPlanPromptMessage(
            existingPlanDecisionState.activePlans.map((studyPlan) => studyPlan.summaryLine),
          ),
        );
        return;
      }

      await this.archiveActiveStudyPlanById(targetPlan.id);

      if (message.guildId) {
        this.pendingPlanCreationModes.set(message.guildId, {
          creationMode: 'PARALLEL',
          activePlanIdsToCancel: [],
        });
      }

      await this.sendChannelMessage(
        message,
        `${selectedArchivePlanNumber}번 코스를 중도 완료 처리했습니다.`,
      );
      await this.handleConfirmedDuration(message, existingPlanDecisionState.pendingDays);
      return;
    }

    await this.sendChannelMessage(message, createDiscordExistingStudyPlanInvalidSelectionMessage());
    await this.sendChannelMessage(
      message,
      createDiscordExistingStudyPlanPromptMessage(
        existingPlanDecisionState.activePlans.map((studyPlan) => studyPlan.summaryLine),
      ),
    );
  }

  // Handles the user's course selection after the three course options are shown.
  // 세 가지 코스 선택지가 보여진 뒤 사용자의 코스 선택 응답을 처리한다.
  private async handleCourseSelection(
    message: Message,
    courseSelectionState: CourseSelectionState,
    selectedCourseName: StudyCourseName | null,
  ) {
    if (!selectedCourseName) {
      if (message.content.trim() === '취소') {
        if (message.guildId) {
          this.pendingPlanCreationModes.delete(message.guildId);
          this.courseSelectionStates.delete(message.guildId);
        }
        await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
        return;
      }

      await this.sendChannelMessage(message, discordInvalidCourseSelectionMessage);
      await this.sendCurrentStudyPlanContext(message, courseSelectionState);
      return;
    }

    await this.previewSelectedCourse(message, courseSelectionState, selectedCourseName);
  }

  // Handles reselection or confirmation after one course has already been shown in detail.
  // 코스 상세를 한 번 보여준 뒤 재선택 또는 확정 입력을 처리한다.
  private async handleCourseConfirmation(
    message: Message,
    courseSelectionState: CourseConfirmationState,
    selectedCourseName: StudyCourseName | null,
  ) {
    if (message.content.trim() === '취소') {
      if (message.guildId) {
        this.pendingPlanCreationModes.delete(message.guildId);
        this.courseSelectionStates.delete(message.guildId);
      }
      await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
      return;
    }

    if (message.content.trim() === '확인') {
      await this.confirmSelectedCourse(message, courseSelectionState);
      return;
    }

    await this.sendChannelMessage(message, discordInvalidCourseConfirmationMessage);
    await this.sendCurrentStudyPlanContext(message, courseSelectionState);
  }

  // Generates, stores, and announces the final day-by-day plan after course confirmation.
  // 코스가 최종 확정되면 일별 계획을 생성하고 저장한 뒤 Discord에 안내한다.
  private async confirmSelectedCourse(
    message: Message,
    courseSelectionState: CourseConfirmationState,
  ) {
    try {
      const cachedStudyPlanTemplate = await this.findStoredStudyPlanTemplate(
        courseSelectionState.previewTemplateId,
      );

      const selectedStudyPlanTemplate =
        cachedStudyPlanTemplate ??
        (await (async () => {
          if (!this.openAiService.isConfigured()) {
            throw new Error('OPENAI_API_KEY가 설정되지 않아 아직 상세 일정을 생성할 수 없습니다.');
          }

          await this.trackCourseGenerationUsage(message, 'DETAILED_PLAN');
          await this.sendChannelMessage(
            message,
            createDiscordDetailedPlanLoadingMessage(courseSelectionState.totalDays),
          );

          const generatedStudyPlan = await this.openAiService.getDetailedStudyPlan(
            courseSelectionState.totalDays,
            courseSelectionState.selectedCourseName,
            courseSelectionState.selectedCourseContent,
          );

          return this.storeStudyPlanTemplate(
            courseSelectionState.previewTemplateId,
            generatedStudyPlan,
          );
        })());

      if (message.guildId) {
        this.courseSelectionStates.set(message.guildId, {
          stage: 'AWAITING_START',
          totalDays: courseSelectionState.totalDays,
          creationMode: courseSelectionState.creationMode,
          activePlanIdsToCancel: courseSelectionState.activePlanIdsToCancel,
          previewTemplateId: courseSelectionState.previewTemplateId,
          planTemplateId: selectedStudyPlanTemplate.id,
          selectedCourseName: courseSelectionState.selectedCourseName,
          selectedCourseContent: courseSelectionState.selectedCourseContent,
          generatedStudyPlan: selectedStudyPlanTemplate.generatedStudyPlan,
        });
      }

      await this.sendChannelMessage(
        message,
        formatGeneratedStudyPlanMessage(selectedStudyPlanTemplate.generatedStudyPlan),
      );
    } catch (error) {
      this.logger.error('Failed to confirm selected course', error);
      await this.sendChannelMessage(
        message,
        this.createStudyPlanErrorMessage('일정 세분화 중 오류가 발생했습니다.', error),
      );
    }
  }

  private async previewSelectedCourse(
    message: Message,
    courseSelectionState: {
      totalDays: number;
      creationMode: PlanCreationMode;
      activePlanIdsToCancel: string[];
    },
    selectedCourseName: StudyCourseName,
  ) {
    try {
      const cachedCoursePreview = await this.findStoredStudyCoursePreviewTemplate(
        courseSelectionState.totalDays,
        selectedCourseName,
      );

      const selectedCoursePreviewTemplate =
        cachedCoursePreview ??
        (await (async () => {
          if (!this.openAiService.isConfigured()) {
            throw new Error('OPENAI_API_KEY가 설정되지 않아 아직 코스 미리보기를 생성할 수 없습니다.');
          }

          await this.trackCourseGenerationUsage(message, 'COURSE_PREVIEW');
          await this.sendChannelMessage(
            message,
            createDiscordStudyCoursePreviewLoadingMessage(courseSelectionState.totalDays),
          );

          const generatedCoursePreview = await this.openAiService.getStudyCoursePreview(
            courseSelectionState.totalDays,
            selectedCourseName,
          );

          return this.storeStudyCoursePreviewTemplate(
            courseSelectionState.totalDays,
            selectedCourseName,
            generatedCoursePreview,
          );
        })());

      if (message.guildId) {
        this.courseSelectionStates.set(message.guildId, {
          stage: 'AWAITING_COURSE_CONFIRMATION',
          totalDays: courseSelectionState.totalDays,
          creationMode: courseSelectionState.creationMode,
          activePlanIdsToCancel: courseSelectionState.activePlanIdsToCancel,
          previewTemplateId: selectedCoursePreviewTemplate.id,
          selectedCourseName,
          selectedCourseContent: selectedCoursePreviewTemplate.contentText,
        });
      }

      await this.sendChannelMessage(
        message,
        createDiscordSelectedCourseMessage(
          selectedCourseName,
          selectedCoursePreviewTemplate.contentText,
        ),
      );
    } catch (error) {
      this.logger.error(`Failed to generate course preview for ${selectedCourseName}`, error);
      await this.sendChannelMessage(
        message,
        this.createStudyPlanErrorMessage('코스 미리보기를 생성하는 중 오류가 발생했습니다.', error),
      );
    }
  }

  private async findStoredStudyCoursePreviewTemplate(
    totalDays: number,
    selectedCourseName: StudyCourseName,
  ) {
    const prismaClient = this.prismaService as any;
    const existingTemplate = await prismaClient.study_course_preview_templates.findFirst({
      where: {
        total_days: totalDays,
        course_name: selectedCourseName,
        prompt_version: this.studyCoursePreviewTemplatePromptVersion,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    if (!existingTemplate) {
      return null;
    }

    await prismaClient.study_course_preview_templates.update({
      where: {
        id: existingTemplate.id,
      },
      data: {
        usage_count: {
          increment: 1,
        },
      },
    });

    return {
      id: existingTemplate.id as string,
      contentText: existingTemplate.content_text as string,
    };
  }

  private async storeStudyCoursePreviewTemplate(
    totalDays: number,
    selectedCourseName: StudyCourseName,
    contentText: string,
  ) {
    const prismaClient = this.prismaService as any;

    const createdTemplate = await prismaClient.study_course_preview_templates.create({
      data: {
        total_days: totalDays,
        course_name: selectedCourseName,
        prompt_version: this.studyCoursePreviewTemplatePromptVersion,
        content_text: contentText,
        usage_count: 1,
      },
    });

    return {
      id: createdTemplate.id as string,
      contentText: createdTemplate.content_text as string,
    };
  }

  private async findDiscordUserByDiscordUserId(discordUserId: string) {
    const prismaClient = this.prismaService as any;

    return prismaClient.discord_users.findUnique({
      where: {
        discord_user_id: discordUserId,
      },
    });
  }

  private async ensureDiscordUser(message: Message) {
    const prismaClient = this.prismaService as any;
    const existingDiscordUser = await this.findDiscordUserByDiscordUserId(message.author.id);

    if (!existingDiscordUser) {
      return prismaClient.discord_users.create({
        data: {
          discord_user_id: message.author.id,
          username: message.author.username,
        },
      });
    }

    if (existingDiscordUser.username !== message.author.username) {
      return prismaClient.discord_users.update({
        where: {
          id: existingDiscordUser.id,
        },
        data: {
          username: message.author.username,
        },
      });
    }

    return existingDiscordUser;
  }

  private async trackCourseGenerationUsage(
    message: Message,
    usageType: 'COURSE_PREVIEW' | 'DETAILED_PLAN',
  ) {
    const prismaClient = this.prismaService as any;
    const discordUser = await this.ensureDiscordUser(message);
    const now = new Date();
    const usageDate = new Date(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00+09:00`,
    );

    const existingUsage = await prismaClient.course_generation_usages.findUnique({
      where: {
        discord_user_uuid_usage_date_usage_type: {
          discord_user_uuid: discordUser.id,
          usage_date: usageDate,
          usage_type: usageType,
        },
      },
    });

    if (existingUsage) {
      return prismaClient.course_generation_usages.update({
        where: {
          id: existingUsage.id,
        },
        data: {
          request_count: {
            increment: 1,
          },
        },
      });
    }

    return prismaClient.course_generation_usages.create({
      data: {
        discord_user_uuid: discordUser.id,
        usage_date: usageDate,
        usage_type: usageType,
        request_count: 1,
      },
    });
  }

  private async findStoredStudyPlanTemplate(previewTemplateId: string) {
    const prismaClient = this.prismaService as any;
    const existingTemplate = await prismaClient.study_plan_templates.findFirst({
      where: {
        course_preview_template_uuid: previewTemplateId,
        prompt_version: this.studyPlanTemplatePromptVersion,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    if (!existingTemplate) {
      return null;
    }

    await prismaClient.study_plan_templates.update({
      where: {
        id: existingTemplate.id,
      },
      data: {
        usage_count: {
          increment: 1,
        },
      },
    });

    const generatedStudyPlan = parseStoredGeneratedStudyPlan(existingTemplate.plan_raw);

    if (!generatedStudyPlan) {
      return null;
    }

    return {
      id: existingTemplate.id as string,
      generatedStudyPlan,
    };
  }

  private async storeStudyPlanTemplate(
    previewTemplateId: string,
    generatedStudyPlan: GeneratedStudyPlan,
  ) {
    const prismaClient = this.prismaService as any;
    const createdTemplate = await prismaClient.study_plan_templates.create({
      data: {
        course_preview_template_uuid: previewTemplateId,
        prompt_version: this.studyPlanTemplatePromptVersion,
        plan_title: generatedStudyPlan.planTitle,
        goal_text: generatedStudyPlan.goalText,
        plan_raw: generatedStudyPlan,
        usage_count: 1,
      },
    });

    return {
      id: createdTemplate.id as string,
      generatedStudyPlan,
    };
  }

  private async findStoredStudyDayMaterialTemplate(planTemplateId: string, dayNumber: number) {
    const prismaClient = this.prismaService as any;
    const existingTemplate = await prismaClient.study_day_material_templates.findUnique({
      where: {
        study_plan_template_uuid_day_number: {
          study_plan_template_uuid: planTemplateId,
          day_number: dayNumber,
        },
      },
    });

    if (!existingTemplate) {
      return null;
    }

    await prismaClient.study_day_material_templates.update({
      where: {
        id: existingTemplate.id,
      },
      data: {
        usage_count: {
          increment: 1,
        },
      },
    });

    return this.parseStoredStudyDayMaterialsTemplate(existingTemplate.materials_raw);
  }

  private async storeStudyDayMaterialTemplate(
    planTemplateId: string,
    dayNumber: number,
    generatedMaterials: GeneratedStudyDayMaterials,
  ) {
    const prismaClient = this.prismaService as any;

    await prismaClient.study_day_material_templates.upsert({
      where: {
        study_plan_template_uuid_day_number: {
          study_plan_template_uuid: planTemplateId,
          day_number: dayNumber,
        },
      },
      update: {
        materials_raw: generatedMaterials,
      },
      create: {
        study_plan_template_uuid: planTemplateId,
        day_number: dayNumber,
        materials_raw: generatedMaterials,
        usage_count: 1,
      },
    });
  }

  private parseStoredStudyDayMaterialsTemplate(materialsRaw: unknown) {
    if (!materialsRaw || typeof materialsRaw !== 'object') {
      return null;
    }

    const rawMaterials = materialsRaw as {
      summaryText?: unknown;
      contentText?: unknown;
      quizIntroText?: unknown;
      quizItems?: unknown;
    };

    if (
      typeof rawMaterials.summaryText !== 'string' ||
      typeof rawMaterials.contentText !== 'string' ||
      typeof rawMaterials.quizIntroText !== 'string' ||
      !Array.isArray(rawMaterials.quizItems)
    ) {
      return null;
    }

    return rawMaterials as GeneratedStudyDayMaterials;
  }

  private extractStoredTemplateMetadata(outlineRaw: unknown) {
    if (!outlineRaw || typeof outlineRaw !== 'object') {
      return {
        previewTemplateId: null,
        planTemplateId: null,
      };
    }

    const rawMetadata = outlineRaw as {
      previewTemplateId?: unknown;
      planTemplateId?: unknown;
    };

    return {
      previewTemplateId:
        typeof rawMetadata.previewTemplateId === 'string' ? rawMetadata.previewTemplateId : null,
      planTemplateId:
        typeof rawMetadata.planTemplateId === 'string' ? rawMetadata.planTemplateId : null,
    };
  }

  // Starts the confirmed study plan, persists it, and publishes the first study day.
  // 확정된 학습 계획을 시작 처리하고 저장한 뒤 1일차 학습 자료를 게시한다.
  private async handleStudyStart(message: Message, startSelectionState: StartSelectionState) {
    if (message.content.trim() === '취소') {
      if (message.guildId) {
        this.pendingPlanCreationModes.delete(message.guildId);
        this.courseSelectionStates.delete(message.guildId);
      }
      await this.sendChannelMessage(message, discordStudyPlanCancelledMessage);
      return;
    }

    if (message.content.trim() !== '시작') {
      await this.sendChannelMessage(message, discordUnsupportedStudyPlanCommandMessage);
      await this.sendCurrentStudyPlanContext(message, startSelectionState);
      return;
    }

    if (message.guildId && this.startLocks.has(message.guildId)) {
      await this.sendChannelMessage(message, discordStudyPlanAlreadyStartingMessage);
      return;
    }

    if (message.guildId) {
      this.startLocks.add(message.guildId);
    }

    let persistedStudyPlan:
      | {
          studyPlanUuid: string;
          startedAt: Date;
          selectedCourseName: StudyCourseName;
          generatedStudyPlan: GeneratedStudyPlan;
          studyDayIdByNumber: Record<number, string>;
          studyPlanId: string;
          studyDayId: string;
          firstStudyDayId: string;
          dayContentId: string;
          quizId: string;
        }
      | null = null;

    try {
      const firstStudyDay = getFirstStudyDay(startSelectionState.generatedStudyPlan);
      const cachedFirstDayMaterials = await this.findStoredStudyDayMaterialTemplate(
        startSelectionState.planTemplateId,
        firstStudyDay.dayNumber,
      );
      const firstDayMaterials =
        cachedFirstDayMaterials ??
        (await (async () => {
          if (!this.openAiService.isConfigured()) {
            throw new Error('OPENAI_API_KEY가 설정되지 않아 아직 1일차 학습 자료를 생성할 수 없습니다.');
          }

          await this.sendChannelMessage(
            message,
            createDiscordStudyStartLoadingMessage(startSelectionState.totalDays),
          );

          const generatedFirstDayMaterials = await this.openAiService.getStudyDayMaterials(
            startSelectionState.generatedStudyPlan.planTitle,
            startSelectionState.generatedStudyPlan.goalText,
            startSelectionState.selectedCourseName,
            firstStudyDay,
          );

          await this.storeStudyDayMaterialTemplate(
            startSelectionState.planTemplateId,
            firstStudyDay.dayNumber,
            generatedFirstDayMaterials,
          );

          return generatedFirstDayMaterials;
        })());

      persistedStudyPlan = await this.persistStartedStudyPlan(
        message,
        startSelectionState,
        firstDayMaterials,
      );

      const publishedThreadIds = await this.publishStudyDayThreads(
        message.guild!,
        startSelectionState.selectedCourseName,
        persistedStudyPlan.startedAt,
        firstStudyDay,
        firstDayMaterials,
      );

      await this.updatePublishedDiscordMessages(persistedStudyPlan, publishedThreadIds);
      await this.sendChannelMessage(
        message,
        [
          '**[학습 시작 완료]**',
          `${firstStudyDay.dayNumber}일차 학습 자료를 생성했습니다.`,
          '다음 일차는 각 일정 날짜의 오전 10시에 자동 게시됩니다.',
          '다음 일차가 게시될 때 이후 버퍼 일차 자료도 함께 준비합니다.',
          'db_tutor, db_quiz, db_answer 채널의 새 스레드를 확인해주세요.',
          '정답 제출은 user_answer 채널, 학습 질문은 user_ask 채널을 사용해주세요.',
        ].join('\n'),
      );
      await this.preGenerateUpcomingStudyDays(
        persistedStudyPlan,
        startSelectionState,
        2,
        Math.min(this.preGeneratedDayCount, startSelectionState.generatedStudyPlan.days.length),
        message.guild!,
      );

      if (message.guildId) {
        this.courseSelectionStates.delete(message.guildId);
      }
    } catch (error) {
      if (error instanceof MissingDiscordChannelError && message.guild && persistedStudyPlan) {
        await this.moveStudyPlanToCancelledListAfterMissingChannel(
          message.guild,
          persistedStudyPlan.studyPlanId,
          {
            resetToBeforeFirstDay: true,
          },
        );
        return;
      }

      this.logger.error('Failed to start confirmed study plan', error);
      const retryGuide = this.shouldSuggestRetryStudyStart(error)
        ? '\n그럼 에러가 발생하였으니 잠시 후에 다시 "시작"을 입력해주세요.'
        : '';
      await this.sendChannelMessage(
        message,
        `${this.createStudyPlanErrorMessage('학습 시작 처리 중 오류가 발생했습니다.', error)}${retryGuide}`,
      );
    } finally {
      if (message.guildId) {
        this.startLocks.delete(message.guildId);
      }
    }
  }

  // Finds the quiz item referenced by a submission thread context and question number.
  // 제출 스레드의 문맥과 문제 번호로 대상 quiz item을 찾아 반환한다.
  private async findSubmissionThreadContextByChannelId(message: Message, questionNo: number) {
    if (!message.guildId || !message.channel.isThread()) {
      return null;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return null;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const mappedStudyDay = await this.prismaService.study_days.findFirst({
      where: {
        user_answer_thread_id: message.channel.id,
        study_plans: {
          guild_uuid: guildRecord.id,
        },
      },
      include: {
        study_plans: {
          select: {
            id: true,
            status: true,
          },
        },
        quizzes: {
          include: {
            quiz_items: {
              where: {
                question_no: questionNo,
              },
            },
          },
        },
      },
    });

    if (!mappedStudyDay) {
      return null;
    }

    return {
      studyPlan: mappedStudyDay.study_plans,
      dayNumber: mappedStudyDay.day_number,
      quizItem: mappedStudyDay.quizzes?.quiz_items[0] ?? null,
    };
  }

  // Finds the quiz item referenced by a submission thread context and question number.
  // 제출 스레드의 문맥과 문제 번호로 대상 quiz item을 찾아 반환한다.
  private async findQuizItemForSubmission(
    message: Message,
    submissionThreadContext:
      | {
          startedDateText: string;
          selectedCourseName: StudyCourseName;
          studyPlanUuid: string | null;
          dayNumber: number;
        }
      | null,
    questionNo: number,
  ) {
    if (!submissionThreadContext || !message.guildId) {
      return null;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return null;
    }

    const threadCreatedAt =
      message.channel.isThread() && message.channel.createdAt ? message.channel.createdAt : null;

    const targetStudyPlan = await this.prismaService.study_plans.findFirst({
      where: {
        ...(submissionThreadContext.studyPlanUuid
          ? {
              id: submissionThreadContext.studyPlanUuid,
              guild_uuid: guildRecord.id,
            }
          : {
              guild_uuid: guildRecord.id,
              requested_range_text: submissionThreadContext.selectedCourseName,
              start_date: new Date(`${submissionThreadContext.startedDateText}T00:00:00+09:00`),
              ...(threadCreatedAt
                ? {
                    created_at: {
                      lte: threadCreatedAt,
                    },
                  }
                : {}),
            }),
      },
      orderBy: {
        created_at: 'desc',
      },
      include: {
        study_days: {
          where: {
            day_number: submissionThreadContext.dayNumber,
          },
          include: {
            quizzes: {
              include: {
                quiz_items: {
                  where: {
                    question_no: questionNo,
                  },
                },
              },
            },
          },
        },
      },
    });

    return targetStudyPlan?.study_days[0]?.quizzes?.quiz_items[0] ?? null;
  }

  // Finds the study plan referenced by a submission or question thread name.
  // 제출 또는 질문 스레드 이름이 가리키는 학습 계획을 조회한다.
  private async findStudyPlanByThreadContext(
    message: Message,
    threadContext:
      | {
          startedDateText: string;
          selectedCourseName: StudyCourseName;
          studyPlanUuid: string | null;
          dayNumber: number;
        }
      | null,
  ) {
    if (!threadContext || !message.guildId) {
      return null;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return null;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const threadCreatedAt =
      message.channel.isThread() && message.channel.createdAt ? message.channel.createdAt : null;

    return this.prismaService.study_plans.findFirst({
      where: {
        ...(threadContext.studyPlanUuid
          ? {
              id: threadContext.studyPlanUuid,
              guild_uuid: guildRecord.id,
            }
          : {
              guild_uuid: guildRecord.id,
              requested_range_text: threadContext.selectedCourseName,
              start_date: new Date(`${threadContext.startedDateText}T00:00:00+09:00`),
              ...(threadCreatedAt
                ? {
                    created_at: {
                      lte: threadCreatedAt,
                    },
                  }
                : {}),
            }),
      },
      orderBy: {
        created_at: 'desc',
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // Finds the current day and earlier study materials needed to answer a learner question.
  // 학습 질문에 답변하는 데 필요한 현재 일차 및 이전 학습 자료를 조회한다.
  private async findStudyQuestionContextByChannelId(message: Message) {
    if (!message.guildId || !message.channel.isThread()) {
      return null;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return null;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const mappedStudyDay = await this.prismaService.study_days.findFirst({
      where: {
        user_ask_thread_id: message.channel.id,
        study_plans: {
          guild_uuid: guildRecord.id,
        },
      },
      select: {
        study_plan_uuid: true,
        day_number: true,
      },
    });

    if (!mappedStudyDay) {
      return null;
    }

    const targetStudyPlan = await this.prismaService.study_plans.findUnique({
      where: {
        id: mappedStudyDay.study_plan_uuid,
      },
      include: {
        study_days: {
          where: {
            day_number: {
              lte: mappedStudyDay.day_number,
            },
          },
          orderBy: {
            day_number: 'asc',
          },
          include: {
            day_contents: true,
            quizzes: {
              include: {
                quiz_items: {
                  orderBy: {
                    question_no: 'asc',
                  },
                  include: {
                    quiz_hints: {
                      orderBy: {
                        hint_no: 'asc',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!targetStudyPlan) {
      return null;
    }

    const currentStudyDay = targetStudyPlan.study_days.find(
      (studyDay) => studyDay.day_number === mappedStudyDay.day_number,
    );

    if (!currentStudyDay) {
      return null;
    }

    return {
      studyPlan: targetStudyPlan,
      currentStudyDay,
      previousStudyDays: targetStudyPlan.study_days.filter(
        (studyDay) => studyDay.day_number < mappedStudyDay.day_number,
      ),
    };
  }

  // Finds the current day and earlier study materials needed to answer a learner question.
  // 학습 질문에 답변하는 데 필요한 현재 일차 및 이전 학습 자료를 조회한다.
  private async findStudyQuestionContext(
    message: Message,
    questionThreadContext:
      | {
          startedDateText: string;
          selectedCourseName: StudyCourseName;
          studyPlanUuid: string | null;
          dayNumber: number;
        }
      | null,
  ) {
    if (!questionThreadContext || !message.guildId) {
      return null;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return null;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const threadCreatedAt =
      message.channel.isThread() && message.channel.createdAt ? message.channel.createdAt : null;

    const targetStudyPlan = await this.prismaService.study_plans.findFirst({
      where: {
        ...(questionThreadContext.studyPlanUuid
          ? {
              id: questionThreadContext.studyPlanUuid,
              guild_uuid: guildRecord.id,
            }
          : {
              guild_uuid: guildRecord.id,
              requested_range_text: questionThreadContext.selectedCourseName,
              start_date: new Date(`${questionThreadContext.startedDateText}T00:00:00+09:00`),
              ...(threadCreatedAt
                ? {
                    created_at: {
                      lte: threadCreatedAt,
                    },
                  }
                : {}),
            }),
      },
      orderBy: {
        created_at: 'desc',
      },
      include: {
        study_days: {
          where: {
            day_number: {
              lte: questionThreadContext.dayNumber,
            },
          },
          orderBy: {
            day_number: 'asc',
          },
          include: {
            day_contents: true,
            quizzes: {
              include: {
                quiz_items: {
                  orderBy: {
                    question_no: 'asc',
                  },
                  include: {
                    quiz_hints: {
                      orderBy: {
                        hint_no: 'asc',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!targetStudyPlan) {
      return null;
    }

    const currentStudyDay = targetStudyPlan.study_days.find(
      (studyDay) => studyDay.day_number === questionThreadContext.dayNumber,
    );

    if (!currentStudyDay) {
      return null;
    }

    return {
      studyPlan: targetStudyPlan,
      currentStudyDay,
      previousStudyDays: targetStudyPlan.study_days.filter(
        (studyDay) => studyDay.day_number < questionThreadContext.dayNumber,
      ),
    };
  }

  // Builds the study context text that is sent to the question-answering LLM.
  // 질문 답변용 LLM에 전달할 학습 문맥 텍스트를 만든다.
  private buildStudyQuestionContextText(studyQuestionContext: {
    studyPlan: {
      goal_text: string;
      requested_range_text: string | null;
    };
    currentStudyDay: {
      day_number: number;
      title: string;
      topic_summary: string;
      learning_goal: string;
      scope_text: string | null;
      day_contents: {
        summary_text: string | null;
        content_text: string;
      } | null;
      quizzes: {
        intro_text: string | null;
        quiz_items: Array<{
          question_no: number;
          prompt_text: string;
          model_answer_text: string;
          explanation_text: string;
          quiz_hints: Array<{
            hint_no: number;
            hint_text: string;
          }>;
        }>;
      } | null;
    };
    previousStudyDays: Array<{
      day_number: number;
      title: string;
      topic_summary: string;
      learning_goal: string;
      day_contents: {
        summary_text: string | null;
        content_text: string;
      } | null;
    }>;
  }) {
    const previousStudySummary = studyQuestionContext.previousStudyDays
      .map((studyDay) =>
        [
          `${studyDay.day_number}일차`,
          `제목: ${studyDay.title}`,
          `요약: ${studyDay.topic_summary}`,
          `학습 목표: ${studyDay.learning_goal}`,
          studyDay.day_contents?.content_text
            ? `학습 내용:\n${studyDay.day_contents.content_text}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');

    const currentQuizSummary = studyQuestionContext.currentStudyDay.quizzes
      ? [
          studyQuestionContext.currentStudyDay.quizzes.intro_text ?? '',
          ...studyQuestionContext.currentStudyDay.quizzes.quiz_items.map((quizItem) =>
            [
              `문제 ${quizItem.question_no}: ${quizItem.prompt_text}`,
              ...quizItem.quiz_hints.map(
                (quizHint) => `힌트 ${quizHint.hint_no}: ${quizHint.hint_text}`,
              ),
              `내부 참고용 모범 답안: ${quizItem.model_answer_text}`,
              `해설 참고: ${quizItem.explanation_text}`,
            ].join('\n'),
          ),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';

    return [
      `전체 목표: ${studyQuestionContext.studyPlan.goal_text}`,
      `선택 코스: ${studyQuestionContext.studyPlan.requested_range_text ?? '미정'}`,
      '',
      `[현재 학습 일차]`,
      `${studyQuestionContext.currentStudyDay.day_number}일차`,
      `제목: ${studyQuestionContext.currentStudyDay.title}`,
      `요약: ${studyQuestionContext.currentStudyDay.topic_summary}`,
      `학습 목표: ${studyQuestionContext.currentStudyDay.learning_goal}`,
      `학습 범위: ${studyQuestionContext.currentStudyDay.scope_text ?? ''}`,
      studyQuestionContext.currentStudyDay.day_contents?.summary_text
        ? `요약 설명: ${studyQuestionContext.currentStudyDay.day_contents.summary_text}`
        : '',
      studyQuestionContext.currentStudyDay.day_contents?.content_text
        ? `상세 학습 내용:\n${studyQuestionContext.currentStudyDay.day_contents.content_text}`
        : '',
      currentQuizSummary ? `현재 일차 문제/힌트:\n${currentQuizSummary}` : '',
      previousStudySummary ? `[이전 학습 자료]\n${previousStudySummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // Finds currently active study plans in the same guild.
  // 같은 서버에서 현재 ACTIVE 상태인 학습 계획 목록을 조회한다.
  private async findActiveStudyPlans(message: Message) {
    if (!message.guildId) {
      return [];
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return [];
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    return this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'ACTIVE',
      },
      orderBy: {
        created_at: 'asc',
      },
    });
  }

  // Sends a study plan list for the requested status in the current guild.
  // 현재 서버에서 요청한 상태의 학습 계획 목록을 조회해 전송한다.
  private async sendStudyPlanList(
    message: Message,
    status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED',
  ) {
    if (!message.guildId) {
      return;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      await this.sendChannelMessage(message, createEmptyStudyPlanListMessage(status));
      return;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const studyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status:
          status === 'COMPLETED'
            ? {
                in: ['COMPLETED', 'ARCHIVED'],
              }
            : status,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    if (studyPlans.length === 0) {
      await this.sendChannelMessage(message, createEmptyStudyPlanListMessage(status));
      return;
    }

    const formattedStudyPlanList = studyPlans.map((studyPlan, index) =>
      formatIndexedStudyPlanSummary(index + 1, studyPlan, status),
    );

    await this.sendChannelMessage(
      message,
      [
        getStudyPlanListTitle(status),
        ...formattedStudyPlanList,
        ...(status === 'ACTIVE'
          ? ['', discordActiveStudyPlanListActionGuideMessage]
          : status === 'CANCELLED'
            ? ['', discordCancelledStudyPlanListActionGuideMessage]
            : []),
      ].join('\n'),
    );
  }

  // Cancels one study plan immediately so a new plan can be created after the user's decision.
  // 사용자가 선택한 학습 계획 하나를 즉시 중단 상태로 바꾼다.
  private async cancelStudyPlanById(studyPlanId: string) {
    await this.prismaService.study_plans.update({
      where: {
        id: studyPlanId,
      },
      data: {
        status: 'CANCELLED',
        next_publish_at: null,
      },
    });
  }

  // Archives one active study plan as a mid-completed course.
  // 현재 진행중인 학습 계획 하나를 중도 완료 상태로 바꾼다.
  private async archiveActiveStudyPlanById(studyPlanId: string) {
    await this.prismaService.study_plans.update({
      where: {
        id: studyPlanId,
      },
      data: {
        status: 'ARCHIVED',
        next_publish_at: null,
      },
    });
  }

  // Cancels one active study plan using the active-list index shown by the list command.
  // 리스트 기준 번호를 받아 현재 진행중인 코스 하나를 즉시 중단 상태로 바꾼다.
  private async stopActiveStudyPlan(message: Message, selectedStopPlanNumber: number) {
    if (!message.guildId) {
      return;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      await this.sendChannelMessage(message, discordStopStudyPlanInvalidSelectionMessage);
      return;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const hasReachedCancelledPlanLimit = await this.hasReachedCancelledStudyPlanLimit(message);

    if (hasReachedCancelledPlanLimit) {
      await this.sendChannelMessage(message, discordCancelledStudyPlanLimitMessage);
      return;
    }

    const activeStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'ACTIVE',
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    const targetStudyPlan = activeStudyPlans[selectedStopPlanNumber - 1];

    if (!targetStudyPlan) {
      await this.sendChannelMessage(
        message,
        discordStopStudyPlanNotActiveMessage(selectedStopPlanNumber),
      );
      await this.sendStudyPlanList(message, 'ACTIVE');
      return;
    }

    await this.cancelStudyPlanById(targetStudyPlan.id);
    await this.sendChannelMessage(message, `${selectedStopPlanNumber}번 코스를 중단하였습니다.`);
  }

  // Converts one cancelled study plan into an archived mid-completion state using the cancelled-list index.
  // 중단리스트 기준 번호를 받아 해당 코스를 중도 완료 상태로 바꾼다.
  private async archiveCancelledStudyPlan(message: Message, selectedArchivePlanNumber: number) {
    if (!message.guildId) {
      return;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      await this.sendChannelMessage(message, discordArchiveStudyPlanInvalidSelectionMessage);
      return;
    }

    const cancelledStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'CANCELLED',
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    const targetStudyPlan = cancelledStudyPlans[selectedArchivePlanNumber - 1];

    if (!targetStudyPlan) {
      await this.sendChannelMessage(message, discordArchiveStudyPlanInvalidSelectionMessage);
      return;
    }

    await this.prismaService.study_plans.update({
      where: {
        id: targetStudyPlan.id,
      },
      data: {
        status: 'ARCHIVED',
        next_publish_at: null,
      },
    });

    await this.sendChannelMessage(
      message,
      `${selectedArchivePlanNumber}번 코스를 중도 완료 처리했습니다.`,
    );
  }

  // Resumes one cancelled study plan when the guild still has room for another active plan.
  // 현재 ACTIVE 코스가 3개 미만이면 중단된 학습 계획 하나를 다시 ACTIVE로 되돌린다.
  private async resumeCancelledStudyPlan(message: Message, selectedResumePlanNumber: number) {
    if (!message.guildId) {
      return;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      await this.sendChannelMessage(message, discordResumeStudyPlanInvalidSelectionMessage);
      return;
    }

    await this.synchronizeCompletedStudyPlans(guildRecord.id);

    const activeStudyPlanCount = await this.prismaService.study_plans.count({
      where: {
        guild_uuid: guildRecord.id,
        status: 'ACTIVE',
      },
    });

    if (activeStudyPlanCount >= 3) {
      await this.sendChannelMessage(message, discordActiveStudyPlanLimitMessage);
      return;
    }

    const cancelledStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildRecord.id,
        status: 'CANCELLED',
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    const targetStudyPlan = cancelledStudyPlans[selectedResumePlanNumber - 1];

    if (!targetStudyPlan) {
      await this.sendChannelMessage(message, discordResumeStudyPlanInvalidSelectionMessage);
      return;
    }

    await this.prismaService.study_plans.update({
      where: {
        id: targetStudyPlan.id,
      },
      data: {
        status: 'ACTIVE',
        next_publish_at:
          targetStudyPlan.current_day < targetStudyPlan.total_days
            ? this.createNextScheduledPublishAt(new Date())
            : null,
      },
    });

    await this.sendChannelMessage(
      message,
      `${selectedResumePlanNumber}번 코스를 다시 진행합니다.`,
    );
  }

  // Checks whether the current guild already has the maximum number of cancelled study plans.
  // 현재 서버에 중단된 학습 계획이 최대 개수까지 쌓였는지 확인한다.
  private async hasReachedCancelledStudyPlanLimit(message: Message) {
    if (!message.guildId) {
      return false;
    }

    const guildRecord = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guildId,
      },
    });

    if (!guildRecord) {
      return false;
    }

    const cancelledStudyPlanCount = await this.prismaService.study_plans.count({
      where: {
        guild_uuid: guildRecord.id,
        status: 'CANCELLED',
      },
    });

    return cancelledStudyPlanCount >= 3;
  }

  // Synchronizes ACTIVE study plans and marks them COMPLETED when the end condition is met.
  // ACTIVE 학습 계획을 점검해서 종료 조건을 만족하면 COMPLETED로 바꾼다.
  private async synchronizeCompletedStudyPlans(guildUuid: string) {
    const activeStudyPlans = await this.prismaService.study_plans.findMany({
      where: {
        guild_uuid: guildUuid,
        status: 'ACTIVE',
      },
      include: {
        study_days: {
          orderBy: {
            day_number: 'asc',
          },
          include: {
            quizzes: {
              include: {
                quiz_items: {
                  include: {
                    submissions: {
                      select: {
                        id: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const activeStudyPlan of activeStudyPlans) {
      if (!this.shouldCompleteStudyPlan(activeStudyPlan)) {
        continue;
      }

      await this.prismaService.$transaction([
        this.prismaService.study_plans.update({
          where: {
            id: activeStudyPlan.id,
          },
          data: {
            status: 'COMPLETED',
            current_day: activeStudyPlan.total_days,
            next_publish_at: null,
          },
        }),
        this.prismaService.study_days.updateMany({
          where: {
            study_plan_uuid: activeStudyPlan.id,
            status: {
              in: ['PENDING', 'IN_PROGRESS'],
            },
          },
          data: {
            status: 'COMPLETED',
          },
        }),
      ]);
    }
  }

  // Determines whether a study plan should be completed after the final scheduled day.
  // 마지막 일정이 지난 뒤 완료 처리해야 하는 학습 계획인지 판단한다.
  private shouldCompleteStudyPlan(activeStudyPlan: {
    id: string;
    total_days: number;
    start_date: Date | null;
    study_days: Array<{
      id: string;
      scheduled_date: Date | null;
      quizzes: {
        quiz_items: Array<{
          id: string;
          submissions: Array<{
            id: string;
          }>;
        }>;
      } | null;
    }>;
  }) {
    const lastScheduledStudyDay = [...activeStudyPlan.study_days]
      .filter((studyDay) => studyDay.scheduled_date)
      .sort((leftDay, rightDay) => {
        return (
          (rightDay.scheduled_date?.getTime() ?? 0) - (leftDay.scheduled_date?.getTime() ?? 0)
        );
      })[0];

    const effectiveLastScheduledDate =
      lastScheduledStudyDay?.scheduled_date ??
      this.createFallbackStudyPlanEndDate(activeStudyPlan.start_date, activeStudyPlan.total_days);

    if (!effectiveLastScheduledDate) {
      return false;
    }

    const todayStart = this.getTodayStart();
    const endDateStart = this.getDateStart(effectiveLastScheduledDate);

    if (todayStart.getTime() <= endDateStart.getTime()) {
      return false;
    }

    const daysSinceEnd = Math.floor(
      (todayStart.getTime() - endDateStart.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (daysSinceEnd >= 3) {
      return true;
    }

    const allStudyDaysHaveQuizItems =
      activeStudyPlan.study_days.length > 0 &&
      activeStudyPlan.study_days.every(
        (studyDay) => (studyDay.quizzes?.quiz_items.length ?? 0) > 0,
      );

    if (!allStudyDaysHaveQuizItems) {
      return false;
    }

    return activeStudyPlan.study_days.every((studyDay) =>
      studyDay.quizzes?.quiz_items.every((quizItem) => quizItem.submissions.length > 0),
    );
  }

  // Builds a fallback end date when all scheduled day rows are not fully available yet.
  // 모든 일차 일정이 아직 준비되지 않았을 때 사용할 기본 종료일을 계산한다.
  private createFallbackStudyPlanEndDate(startDate: Date | null, totalDays: number) {
    if (!startDate) {
      return null;
    }

    const fallbackEndDate = new Date(startDate);
    fallbackEndDate.setDate(fallbackEndDate.getDate() + (totalDays - 1));

    return fallbackEndDate;
  }

  // Returns the local start-of-day time for a given date.
  // 주어진 날짜를 로컬 자정 시각으로 맞춰 반환한다.
  private getDateStart(date: Date) {
    const startedDate = new Date(date);
    startedDate.setHours(0, 0, 0, 0);
    return startedDate;
  }

  // Returns today's local start-of-day time.
  // 오늘 날짜의 로컬 자정 시각을 반환한다.
  private getTodayStart() {
    return this.getDateStart(new Date());
  }

  // Sends a status-specific notice for inactive study plans and schedules both messages for deletion.
  // 비활성 학습 계획 상태에 맞는 안내를 보내고 사용자 메시지와 함께 삭제를 예약한다.
  private async sendInactivePlanNotice(
    message: Message,
    studyPlanStatus: 'DRAFT' | 'READY' | 'CANCELLED' | 'COMPLETED' | 'ARCHIVED',
    delayMs: number,
  ) {
    const inactivePlanNotice = await message.reply(
      studyPlanStatus === 'CANCELLED'
        ? '현재 중단된 코스입니다. 이 안내 메시지와 작성하신 메시지는 5분 뒤에 삭제됩니다.'
        : studyPlanStatus === 'ARCHIVED'
          ? '이미 중도 종료된 코스입니다. 이 안내 메시지와 작성하신 메시지는 5분 뒤에 삭제됩니다.'
        : '이미 종료된 코스입니다. 이 안내 메시지와 작성하신 메시지는 5분 뒤에 삭제됩니다.',
    );
    this.scheduleMessageDeletion(message, delayMs);
    this.scheduleMessageDeletion(inactivePlanNotice, delayMs);
  }

  // Resolves the stored plan creation mode and falls back to parallel mode by default.
  // 저장된 새 플랜 생성 방식을 읽고 없으면 기본 병행 모드로 처리한다.
  private resolvePendingPlanCreationMode(guildId: string | null) {
    if (!guildId) {
      return {
        creationMode: 'PARALLEL' as const,
        activePlanIdsToCancel: [],
      };
    }

    return (
      this.pendingPlanCreationModes.get(guildId) ?? {
        creationMode: 'PARALLEL' as const,
        activePlanIdsToCancel: [],
      }
    );
  }

  // Persists the confirmed study plan and each generated study day into the database.
  // 확정된 학습 계획과 생성된 일차별 계획을 DB에 저장한다.
  private async persistStartedStudyPlan(
    message: Message,
    startSelectionState: StartSelectionState,
    firstDayMaterials: GeneratedStudyDayMaterials,
  ) {
    if (!message.guildId) {
      throw new Error('Guild id is required to persist a study plan.');
    }

    const guildRecord = await this.ensureDiscordGuild(message);
    const memberRecord = await this.ensureDiscordMember(message, guildRecord.id);
    const startedAt = new Date();

    return this.prismaService.$transaction(async (tx) => {
      if (
        startSelectionState.creationMode === 'REPLACE' &&
        startSelectionState.activePlanIdsToCancel.length > 0
      ) {
        await tx.study_plans.updateMany({
          where: {
            id: {
              in: startSelectionState.activePlanIdsToCancel,
            },
            status: 'ACTIVE',
          },
          data: {
            status: 'CANCELLED',
            next_publish_at: null,
          },
        });
      }

      const createdStudyPlan = await tx.study_plans.create({
        data: {
          guild_uuid: guildRecord.id,
          creator_member_uuid: memberRecord.id,
          goal_text: startSelectionState.generatedStudyPlan.goalText,
          requested_range_text: startSelectionState.selectedCourseName,
          total_days: startSelectionState.totalDays,
          start_date: startedAt,
          current_day: 1,
          next_publish_at:
            startSelectionState.totalDays > 1
              ? this.createNextScheduledPublishAt(startedAt)
              : null,
          status: 'ACTIVE',
          outline_raw: {
            courseName: startSelectionState.selectedCourseName,
            courseContent: startSelectionState.selectedCourseContent,
            previewTemplateId: startSelectionState.previewTemplateId,
            planTemplateId: startSelectionState.planTemplateId,
          },
          plan_raw: startSelectionState.generatedStudyPlan,
        },
      });

      const createdStudyDays = [] as Array<{ id: string; dayNumber: number }>;

      for (const generatedDay of startSelectionState.generatedStudyPlan.days) {
        const scheduledDate = new Date(startedAt);
        scheduledDate.setDate(startedAt.getDate() + (generatedDay.dayNumber - 1));

        const createdStudyDay = await tx.study_days.create({
          data: {
            study_plan_uuid: createdStudyPlan.id,
            day_number: generatedDay.dayNumber,
            title: generatedDay.title,
            topic_summary: generatedDay.topicSummary,
            learning_goal: generatedDay.learningGoal,
            scope_text: generatedDay.scopeText,
            scheduled_date: scheduledDate,
            status: generatedDay.dayNumber === 1 ? 'IN_PROGRESS' : 'PENDING',
          },
        });

        createdStudyDays.push({
          id: createdStudyDay.id,
          dayNumber: createdStudyDay.day_number,
        });
      }

      const firstStudyDay = createdStudyDays.find((studyDay) => studyDay.dayNumber === 1);

      if (!firstStudyDay) {
        throw new Error('Failed to find persisted first study day.');
      }

      const createdDayContent = await tx.day_contents.create({
        data: {
          study_day_uuid: firstStudyDay.id,
          summary_text: firstDayMaterials.summaryText,
          content_text: firstDayMaterials.contentText,
          llm_raw: firstDayMaterials,
        },
      });

      const createdQuiz = await tx.quizzes.create({
        data: {
          study_day_uuid: firstStudyDay.id,
          intro_text: firstDayMaterials.quizIntroText,
        },
      });

      for (const quizItem of firstDayMaterials.quizItems) {
        const createdQuizItem = await tx.quiz_items.create({
          data: {
            quiz_uuid: createdQuiz.id,
            question_no: quizItem.questionNo,
            prompt_text: quizItem.promptText,
            expected_points: quizItem.expectedPoints,
            model_answer_text: quizItem.modelAnswerText,
            explanation_text: quizItem.explanationText,
          },
        });

        for (const [hintIndex, hintText] of quizItem.hintTexts.entries()) {
          await tx.quiz_hints.create({
            data: {
              quiz_item_uuid: createdQuizItem.id,
              hint_no: hintIndex + 1,
              hint_text: hintText,
              llm_raw: {
                questionNo: quizItem.questionNo,
              },
            },
          });
        }
      }

      return {
        studyPlanUuid: createdStudyPlan.id,
        startedAt: createdStudyPlan.created_at,
        selectedCourseName: startSelectionState.selectedCourseName,
        generatedStudyPlan: startSelectionState.generatedStudyPlan,
        studyDayIdByNumber: createdStudyDays.reduce<Record<number, string>>((accumulator, studyDay) => {
          accumulator[studyDay.dayNumber] = studyDay.id;
          return accumulator;
        }, {}),
        studyPlanId: createdStudyPlan.id,
        studyDayId: firstStudyDay.id,
        firstStudyDayId: firstStudyDay.id,
        dayContentId: createdDayContent.id,
        quizId: createdQuiz.id,
      };
    });
  }

  // Ensures the current Discord guild exists in the database before saving plan data.
  // 계획 저장 전에 현재 Discord 서버 정보가 DB에 존재하도록 보장한다.
  private async ensureDiscordGuild(message: Message) {
    if (!message.guild) {
      throw new Error('Guild data is required to persist a study plan.');
    }

    const guildOwnerId = message.guild.ownerId;
    const ownerDiscordUser =
      guildOwnerId === message.author.id
        ? await this.ensureDiscordUser(message)
        : await this.findDiscordUserByDiscordUserId(guildOwnerId);
    const existingGuild = await this.prismaService.discord_guilds.findUnique({
      where: {
        discord_guild_id: message.guild.id,
      },
    });

    if (existingGuild) {
      const existingGuildOwnerId = (existingGuild as {
        owner_discord_user_id?: string | null;
      }).owner_discord_user_id;

      if (
        existingGuild.name !== message.guild.name ||
        existingGuildOwnerId !== guildOwnerId
      ) {
        return this.prismaService.discord_guilds.update({
          where: {
            id: existingGuild.id,
          },
          data: {
            name: message.guild.name,
            owner_discord_user_id: guildOwnerId,
            owner_discord_user_uuid: ownerDiscordUser?.id ?? null,
          } as any,
        });
      }

      return existingGuild;
    }

    return this.prismaService.discord_guilds.create({
      data: {
        discord_guild_id: message.guild.id,
        name: message.guild.name,
        owner_discord_user_id: guildOwnerId,
        owner_discord_user_uuid: ownerDiscordUser?.id ?? null,
      } as any,
    });
  }

  // Ensures the current guild owner exists in the database before saving plan data.
  // 계획 저장 전에 현재 서버장 정보가 DB에 존재하도록 보장한다.
  private async ensureDiscordMember(message: Message, guildUuid: string) {
    const discordUser = await this.ensureDiscordUser(message);
    const existingMember = await this.prismaService.discord_members.findFirst({
      where: {
        guild_uuid: guildUuid,
        discord_user_id: message.author.id,
      },
    });

    if (existingMember) {
      if (
        (existingMember as { discord_user_uuid?: string | null }).discord_user_uuid !==
          discordUser.id ||
        existingMember.username !== message.author.username ||
        existingMember.display_name !== (message.member?.displayName ?? null)
      ) {
        return this.prismaService.discord_members.update({
          where: {
            id: existingMember.id,
          },
          data: {
            discord_user_uuid: discordUser.id,
            username: message.author.username,
            display_name: message.member?.displayName ?? null,
          } as any,
        });
      }

      return existingMember;
    }

    return this.prismaService.discord_members.create({
      data: {
        guild_uuid: guildUuid,
        discord_user_id: message.author.id,
        discord_user_uuid: discordUser.id,
        username: message.author.username,
        display_name: message.member?.displayName ?? null,
      } as any,
    });
  }

  // Checks whether the current message was sent by the guild owner.
  // 현재 메시지를 보낸 사용자가 서버장인지 확인한다.
  private isGuildOwnerMessage(message: Message) {
    return message.guild?.ownerId === message.author.id;
  }

  // Publishes one study day to the Discord study forum channels.
  // 특정 학습 일차 자료를 Discord 학습 포럼 채널에 게시한다.
  private async publishStudyDayThreads(
    guild: Guild,
    selectedCourseName: StudyCourseName,
    startedAt: Date,
    firstStudyDay: GeneratedStudyPlanDay,
    firstDayMaterials: GeneratedStudyDayMaterials,
  ) {
    const createdThreads: Array<{
      id: string;
      delete: (reason?: string) => Promise<unknown>;
    }> = [];

    try {
      await guild.channels.fetch();

      const tutorChannel = this.getForumChannelByName(guild, 'db_tutor');
      const quizChannel = this.getForumChannelByName(guild, 'db_quiz');
      const answerChannel = this.getForumChannelByName(guild, 'db_answer');
      const userAnswerChannel = this.getForumChannelByName(guild, 'user_answer');
      const userAskChannel = this.getForumChannelByName(guild, 'user_ask');

      const tutorThread = await this.createForumThreadWithChunks(
        tutorChannel,
        createStudyDayThreadName(startedAt, selectedCourseName, firstStudyDay),
        formatTutorThreadMessage(firstStudyDay, firstDayMaterials),
      );
      createdThreads.push(tutorThread.thread);

      const quizThread = await this.createForumThreadWithChunks(
        quizChannel,
        createStudyDayThreadName(startedAt, selectedCourseName, firstStudyDay, '문제'),
        formatQuizThreadMessage(firstStudyDay, firstDayMaterials),
      );
      createdThreads.push(quizThread.thread);

      const answerThread = await this.createForumThreadWithChunks(
        answerChannel,
        createStudyDayThreadName(startedAt, selectedCourseName, firstStudyDay, '정답'),
        formatAnswerThreadMessage(firstStudyDay, firstDayMaterials),
      );
      createdThreads.push(answerThread.thread);

      const userAnswerThread = await this.createForumThreadWithChunks(
        userAnswerChannel,
        createUserAnswerThreadName(startedAt, selectedCourseName, firstStudyDay),
        formatUserAnswerThreadMessage(firstStudyDay),
      );
      createdThreads.push(userAnswerThread.thread);

      const userAskThread = await this.createForumThreadWithChunks(
        userAskChannel,
        createUserAskThreadName(startedAt, selectedCourseName, firstStudyDay),
        formatUserAskThreadMessage(firstStudyDay),
      );
      createdThreads.push(userAskThread.thread);

      return {
        tutorMessageId: tutorThread.starterMessageId,
        quizMessageId: quizThread.starterMessageId,
        answerMessageId: answerThread.starterMessageId,
        userAnswerThreadId: userAnswerThread.threadId,
        userAskThreadId: userAskThread.threadId,
      };
    } catch (error) {
      await this.rollbackPublishedStudyDayThreads(createdThreads);

      if (error instanceof MissingDiscordChannelError) {
        await this.reportMissingDiscordChannel(guild, error);
      }

      throw error;
    }
  }

  // Updates stored Discord message ids after the first-day forum posts are created.
  // 1일차 포럼 게시글이 생성된 뒤 Discord 메시지 id를 DB에 반영한다.
  private async updatePublishedDiscordMessages(
    persistedStudyPlan: {
      studyDayId: string;
      dayContentId: string;
      quizId: string;
    },
    publishedThreadIds: {
      tutorMessageId: string | null;
      quizMessageId: string | null;
      answerMessageId: string | null;
      userAnswerThreadId: string;
      userAskThreadId: string;
    },
  ) {
    const publishedAt = new Date();

    await this.prismaService.$transaction([
      this.prismaService.day_contents.update({
        where: {
          id: persistedStudyPlan.dayContentId,
        },
        data: {
          discord_message_id: publishedThreadIds.tutorMessageId,
          published_at: publishedThreadIds.tutorMessageId ? publishedAt : null,
        },
      }),
      this.prismaService.quizzes.update({
        where: {
          id: persistedStudyPlan.quizId,
        },
        data: {
          discord_message_id: publishedThreadIds.quizMessageId,
          published_at: publishedThreadIds.quizMessageId ? publishedAt : null,
        },
      }),
      this.prismaService.study_days.update({
        where: {
          id: persistedStudyPlan.studyDayId,
        },
        data: {
          user_answer_thread_id: publishedThreadIds.userAnswerThreadId,
          user_ask_thread_id: publishedThreadIds.userAskThreadId,
        },
      }),
    ]);
  }

  // Returns a named forum channel from the current guild or throws when it is missing.
  // 현재 서버에서 이름으로 포럼 채널을 찾아 반환하고 없으면 예외를 던진다.
  private getForumChannelByName(guild: Guild, channelName: string) {
    const forumChannel = guild.channels.cache.find(
      (channel) => channel?.name === channelName && channel.type === ChannelType.GuildForum,
    );

    if (!forumChannel) {
      throw new MissingDiscordChannelError(channelName, 'forum');
    }

    return forumChannel as ForumChannel;
  }

  private async getStudyPlanTextChannel(guild: Guild) {
    await guild.channels.fetch();

    const studyPlanChannel = guild.channels.cache.find(
      (channel) => channel?.name === 'db_study_plan' && channel.type === ChannelType.GuildText,
    );

    if (!studyPlanChannel) {
      throw new MissingDiscordChannelError('db_study_plan', 'text');
    }

    return studyPlanChannel as TextChannel;
  }

  // Creates a forum thread and posts additional chunks when the content exceeds Discord's message limit.
  // Discord 메시지 제한을 넘는 경우 포럼 스레드를 만들고 나머지 내용을 이어서 분할 게시한다.
  private async createForumThreadWithChunks(
    forumChannel: ForumChannel,
    threadName: string,
    content: string,
  ) {
    const contentChunks = this.splitDiscordMessageContent(content);
    const createdThread = await forumChannel.threads.create({
      name: threadName,
      message: {
        content: contentChunks[0],
      },
    });

    for (const contentChunk of contentChunks.slice(1)) {
      await createdThread.send(contentChunk);
    }

    const starterMessage = await createdThread.fetchStarterMessage();

    return {
      starterMessageId: starterMessage?.id ?? null,
      threadId: createdThread.id,
      thread: createdThread,
    };
  }

  private async rollbackPublishedStudyDayThreads(
    createdThreads: Array<{
      id: string;
      delete: (reason?: string) => Promise<unknown>;
    }>,
  ) {
    for (const createdThread of [...createdThreads].reverse()) {
      try {
        await createdThread.delete('Partial publish rollback');
      } catch (error) {
        this.logger.warn(
          `Failed to rollback partially published thread ${createdThread.id}: ${this.getReadableStudyPlanErrorReason(error)}`,
        );
      }
    }
  }

  // Splits long Discord content into safe message-sized chunks while trying to keep paragraph boundaries.
  // 긴 Discord 본문을 문단 경계를 최대한 유지하면서 안전한 길이의 메시지 조각으로 나눈다.
  private splitDiscordMessageContent(content: string, maxLength = 1900) {
    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of content.split('\n\n')) {
      const paragraphWithSpacing = currentChunk ? `\n\n${paragraph}` : paragraph;

      if ((currentChunk + paragraphWithSpacing).length <= maxLength) {
        currentChunk += paragraphWithSpacing;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      if (paragraph.length <= maxLength) {
        currentChunk = paragraph;
        continue;
      }

      for (const line of paragraph.split('\n')) {
        const lineWithSpacing = currentChunk ? `\n${line}` : line;

        if ((currentChunk + lineWithSpacing).length <= maxLength) {
          currentChunk += lineWithSpacing;
          continue;
        }

        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }

        if (line.length <= maxLength) {
          currentChunk = line;
          continue;
        }

        for (let startIndex = 0; startIndex < line.length; startIndex += maxLength) {
          chunks.push(line.slice(startIndex, startIndex + maxLength));
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  // Schedules a Discord message to be deleted after the given delay.
  // 주어진 시간이 지난 뒤 Discord 메시지를 삭제하도록 예약한다.
  private scheduleMessageDeletion(message: Message, delayMs: number) {
    setTimeout(() => {
      void (async () => {
        if (!message.deletable) {
          return;
        }

        try {
          await message.delete();
        } catch (error) {
          this.logger.warn(`Failed to delete message ${message.id}: ${String(error)}`);
        }
      })();
    }, delayMs);
  }

  // Deletes recognized control messages so the study plan channel stays clean.
  // 서버장이 아닌 사용자의 메시지를 정리하기 위해 메시지를 삭제한다.
  private async deleteControlMessage(message: Message) {
    if (!message.deletable) {
      this.logger.warn(`Could not delete control message ${message.id}`);
      return;
    }

    await message.delete();
  }
}
