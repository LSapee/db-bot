import { Injectable } from '@nestjs/common';
import { Message } from 'discord.js';
import {
  GeneratedStudyDayMaterials,
  GeneratedStudyPlan,
} from '../../openai/openai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { parseStoredGeneratedStudyPlan } from './discord-study-plan.parsers';
import { StudyCourseName } from './discord-study-plan.types';

@Injectable()
export class DiscordStudyPlanStorageService {
  constructor(private readonly prismaService: PrismaService) {}

  async findStoredStudyCoursePreviewTemplate(
    totalDays: number,
    selectedCourseName: StudyCourseName,
    promptVersion: number,
  ) {
    const existingTemplate = await this.prismaService.study_course_preview_templates.findFirst({
      where: {
        total_days: totalDays,
        course_name: selectedCourseName,
        prompt_version: promptVersion,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    if (!existingTemplate) {
      return null;
    }

    await this.prismaService.study_course_preview_templates.update({
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
      id: existingTemplate.id,
      contentText: existingTemplate.content_text,
    };
  }

  async storeStudyCoursePreviewTemplate(
    totalDays: number,
    selectedCourseName: StudyCourseName,
    promptVersion: number,
    contentText: string,
  ) {
    const createdTemplate = await this.prismaService.study_course_preview_templates.create({
      data: {
        total_days: totalDays,
        course_name: selectedCourseName,
        prompt_version: promptVersion,
        content_text: contentText,
        usage_count: 1,
      },
    });

    return {
      id: createdTemplate.id,
      contentText: createdTemplate.content_text,
    };
  }

  async trackCourseGenerationUsage(
    message: Message,
    usageType: 'COURSE_PREVIEW' | 'DETAILED_PLAN',
  ) {
    const discordUser = await this.ensureDiscordUser(message);
    const now = new Date();
    const usageDate = new Date(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}T00:00:00+09:00`,
    );

    const existingUsage = await this.prismaService.course_generation_usages.findUnique({
      where: {
        discord_user_uuid_usage_date_usage_type: {
          discord_user_uuid: discordUser.id,
          usage_date: usageDate,
          usage_type: usageType,
        },
      },
    });

    if (existingUsage) {
      return this.prismaService.course_generation_usages.update({
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

    return this.prismaService.course_generation_usages.create({
      data: {
        discord_user_uuid: discordUser.id,
        usage_date: usageDate,
        usage_type: usageType,
        request_count: 1,
      },
    });
  }

  async findStoredStudyPlanTemplate(previewTemplateId: string, promptVersion: number) {
    const existingTemplate = await this.prismaService.study_plan_templates.findFirst({
      where: {
        course_preview_template_uuid: previewTemplateId,
        prompt_version: promptVersion,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    if (!existingTemplate) {
      return null;
    }

    await this.prismaService.study_plan_templates.update({
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
      id: existingTemplate.id,
      generatedStudyPlan,
    };
  }

  async storeStudyPlanTemplate(
    previewTemplateId: string,
    promptVersion: number,
    generatedStudyPlan: GeneratedStudyPlan,
  ) {
    const createdTemplate = await this.prismaService.study_plan_templates.create({
      data: {
        course_preview_template_uuid: previewTemplateId,
        prompt_version: promptVersion,
        plan_title: generatedStudyPlan.planTitle,
        goal_text: generatedStudyPlan.goalText,
        plan_raw: generatedStudyPlan,
        usage_count: 1,
      },
    });

    return {
      id: createdTemplate.id,
      generatedStudyPlan,
    };
  }

  async findStoredStudyDayMaterialTemplate(planTemplateId: string, dayNumber: number) {
    const existingTemplate = await this.prismaService.study_day_material_templates.findUnique({
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

    await this.prismaService.study_day_material_templates.update({
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

  async storeStudyDayMaterialTemplate(
    planTemplateId: string,
    dayNumber: number,
    generatedMaterials: GeneratedStudyDayMaterials,
  ) {
    await this.prismaService.study_day_material_templates.upsert({
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

  async ensureDiscordGuild(message: Message) {
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
      if (
        existingGuild.name !== message.guild.name ||
        existingGuild.owner_discord_user_id !== guildOwnerId
      ) {
        return this.prismaService.discord_guilds.update({
          where: {
            id: existingGuild.id,
          },
          data: {
            name: message.guild.name,
            owner_discord_user_id: guildOwnerId,
            owner_discord_user_uuid: ownerDiscordUser?.id ?? null,
          },
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
      },
    });
  }

  async ensureDiscordMember(message: Message, guildUuid: string) {
    const discordUser = await this.ensureDiscordUser(message);
    const existingMember = await this.prismaService.discord_members.findFirst({
      where: {
        guild_uuid: guildUuid,
        discord_user_id: message.author.id,
      },
    });

    if (existingMember) {
      if (
        existingMember.discord_user_uuid !== discordUser.id ||
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
          },
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
      },
    });
  }

  private async findDiscordUserByDiscordUserId(discordUserId: string) {
    return this.prismaService.discord_users.findUnique({
      where: {
        discord_user_id: discordUserId,
      },
    });
  }

  private async ensureDiscordUser(message: Message) {
    const existingDiscordUser = await this.findDiscordUserByDiscordUserId(message.author.id);

    if (!existingDiscordUser) {
      return this.prismaService.discord_users.create({
        data: {
          discord_user_id: message.author.id,
          username: message.author.username,
        },
      });
    }

    if (existingDiscordUser.username !== message.author.username) {
      return this.prismaService.discord_users.update({
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
      typeof rawMaterials.contentText !== 'string' ||
      !Array.isArray(rawMaterials.quizItems)
    ) {
      return null;
    }

    const quizItems = rawMaterials.quizItems
      .map((quizItem, index) => {
        if (!quizItem || typeof quizItem !== 'object') {
          return null;
        }

        const rawQuizItem = quizItem as {
          questionNo?: unknown;
          promptText?: unknown;
          expectedPoints?: unknown;
          hintTexts?: unknown;
          modelAnswerText?: unknown;
          explanationText?: unknown;
        };

        if (
          typeof rawQuizItem.promptText !== 'string' ||
          !Array.isArray(rawQuizItem.expectedPoints) ||
          !Array.isArray(rawQuizItem.hintTexts) ||
          typeof rawQuizItem.modelAnswerText !== 'string' ||
          typeof rawQuizItem.explanationText !== 'string'
        ) {
          return null;
        }

        const expectedPoints = rawQuizItem.expectedPoints
          .map((expectedPoint) => String(expectedPoint).trim())
          .filter(Boolean);
        const hintTexts = rawQuizItem.hintTexts
          .map((hintText) => String(hintText).trim())
          .filter(Boolean);

        if (expectedPoints.length === 0 || hintTexts.length === 0) {
          return null;
        }

        return {
          questionNo:
            typeof rawQuizItem.questionNo === 'number'
              ? rawQuizItem.questionNo
              : index + 1,
          promptText: rawQuizItem.promptText,
          expectedPoints,
          hintTexts,
          modelAnswerText: rawQuizItem.modelAnswerText,
          explanationText: rawQuizItem.explanationText,
        };
      })
      .filter(
        (
          quizItem,
        ): quizItem is {
          questionNo: number;
          promptText: string;
          expectedPoints: string[];
          hintTexts: string[];
          modelAnswerText: string;
          explanationText: string;
        } => Boolean(quizItem),
      );

    if (quizItems.length === 0) {
      return null;
    }

    return {
      summaryText:
        typeof rawMaterials.summaryText === 'string' ? rawMaterials.summaryText : '',
      contentText: rawMaterials.contentText,
      quizIntroText:
        typeof rawMaterials.quizIntroText === 'string' ? rawMaterials.quizIntroText : '',
      quizItems,
    } satisfies GeneratedStudyDayMaterials;
  }
}
