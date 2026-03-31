import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseUrl: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.get<string>('DATABASE_URL');
    const adapter = databaseUrl
      ? new PrismaPg({
          connectionString: databaseUrl,
        })
      : undefined;

    super(
      adapter
        ? {
            adapter,
          }
        : ({
            adapter: undefined as never,
          } as never),
    );

    this.databaseUrl = databaseUrl;
  }

  async onModuleInit() {
    if (!this.databaseUrl) {
      this.logger.warn('DATABASE_URL is not configured; Prisma connection skipped');
      return;
    }

    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    if (!this.databaseUrl) {
      return;
    }

    await this.$disconnect();
  }
}
