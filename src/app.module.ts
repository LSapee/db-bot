import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { OpenAiModule } from './openai/openai.module';
import { DiscordModule } from './discord/discord.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['secrets/.env', '.env'],
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    OpenAiModule,
    DiscordModule,
  ],
})
export class AppModule {}
