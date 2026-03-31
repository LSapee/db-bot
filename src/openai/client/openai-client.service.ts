import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAiClientService {
  private readonly logger = new Logger(OpenAiClientService.name);
  readonly client: OpenAI | null;
  readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.model =
      this.configService.get<string>('OPENAI_MODEL') ??
      process.env.OPENAI_MODEL ??
      'gpt-5.4-mini';

    if (!this.client) {
      this.logger.warn('OPENAI_API_KEY is not configured. OpenAI requests are disabled.');
    }
  }

  // Returns whether the OpenAI client can be used in the current environment.
  // 현재 환경에서 OpenAI 클라이언트를 사용할 수 있는지 반환한다.
  isConfigured() {
    return this.client !== null;
  }

  // Returns a usable OpenAI client or throws when configuration is missing.
  // 설정이 없으면 예외를 던지고, 있으면 사용할 수 있는 OpenAI 클라이언트를 반환한다.
  requireClient() {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    return this.client;
  }
}
